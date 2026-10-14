const express = require('express');
const { celebrate, Joi, Segments } = require('celebrate');
const validator = require('validator');
const _ = require('lodash');
const moment = require('moment');
const { requireScope } = require('../lib/auth');
const { keyFor } = require('../lib/rateCache');

const address = Joi.object({
  country: Joi.string().length(2).uppercase().required(),
  postcode: Joi.string().max(16).required(),
  city: Joi.string().max(64),
});

module.exports = function v1({ registry, cache, statusFeed }) {
  const router = express.Router();

  /**
   * @openapi
   * /v1/rates:
   *   post:
   *     summary: Quote every enabled carrier and return the options cheapest first
   *     tags: [rates]
   */
  router.post(
    '/rates',
    requireScope('rates:read'),
    celebrate({
      [Segments.BODY]: Joi.object({
        from: address.required(),
        to: address.required(),
        weightKg: Joi.number().positive().max(70).required(),
        shipDate: Joi.date().iso().min('now').default(() => moment().add(1, 'day').format('YYYY-MM-DD')),
        carriers: Joi.array().items(Joi.string().valid(...Object.keys(registry))),
      }),
    }),
    async (req, res) => {
      const key = keyFor(req.body);
      const cached = await cache.get(key);
      if (cached) return res.set('X-Cache', 'hit').json({ quotes: cached });

      const names = req.body.carriers || Object.keys(registry);
      const settled = await Promise.allSettled(names.map((n) => registry[n].breaker.call(() => registry[n].adapter.quote(req.body))));
      const quotes = _.sortBy(_.flatten(settled.filter((s) => s.status === 'fulfilled').map((s) => s.value)), ['price', 'deliveryBy']);
      const failed = names.filter((n, i) => settled[i].status === 'rejected');
      if (quotes.length) await cache.set(key, quotes);
      return res.set('X-Cache', 'miss').json({ quotes, failed });
    }
  );

  /**
   * @openapi
   * /v1/labels:
   *   post:
   *     summary: Buy a label from the chosen carrier
   *     tags: [labels]
   */
  router.post(
    '/labels',
    requireScope('labels:write'),
    celebrate({
      [Segments.BODY]: Joi.object({
        carrier: Joi.string().valid(...Object.keys(registry)).required(),
        reference: Joi.string().pattern(/^ST-[0-9A-F]{8}$/).required(),
        from: address.required(),
        to: address.required(),
        weightKg: Joi.number().positive().max(70).required(),
        shipDate: Joi.date().iso(),
        contactEmail: Joi.string().custom((v, h) => (validator.isEmail(v) ? validator.normalizeEmail(v) : h.error('any.invalid'))),
      }),
    }),
    async (req, res, next) => {
      const { adapter, breaker } = registry[req.body.carrier];
      try {
        const label = await breaker.call(() => adapter.label(req.body));
        statusFeed.publish({ type: 'label.created', carrier: req.body.carrier, reference: req.body.reference });
        return res.status(201).json(label);
      } catch (err) {
        return next(err);
      }
    }
  );

  /**
   * @openapi
   * /v1/tracking/{trackingNumber}:
   *   get:
   *     summary: Normalised tracking events
   *     tags: [tracking]
   */
  router.get('/tracking/:trackingNumber', requireScope('tracking:read'), async (req, res, next) => {
    const carrier = req.query.carrier || detectCarrier(req.params.trackingNumber);
    if (!registry[carrier]) return res.status(400).json({ error: 'unknown_carrier' });
    try {
      const events = await registry[carrier].breaker.call(() => registry[carrier].adapter.track(req.params.trackingNumber));
      return res.json({ trackingNumber: req.params.trackingNumber, carrier, events: _.sortBy(events, 'timestamp') });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/carriers', (req, res) => {
    res.json({ carriers: _.map(registry, (r, name) => ({ name, circuit: r.breaker.state })) });
  });

  return router;
};

function detectCarrier(trackingNumber) {
  if (/^1Z[0-9A-Z]{16}$/.test(trackingNumber)) return 'ups';
  if (/^[0-9]{10}$/.test(trackingNumber)) return 'dhl';
  if (/^[A-Z]{2}[0-9]{9}SE$/.test(trackingNumber)) return 'postnord';
  return null;
}

module.exports.detectCarrier = detectCarrier;
