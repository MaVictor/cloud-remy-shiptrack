const express = require('express');
const { celebrate, Joi, Segments } = require('celebrate');
const jsonwebtoken = require('jsonwebtoken');
const config = require('../config');
const accounts = require('../services/accounts');
const outbound = require('../services/outboundWebhooks');
const csvImport = require('../services/csvImport');
const notes = require('../services/notes');
const savedSearches = require('../services/savedSearches');
const orders = require('../services/orders');
const notifier = require('../services/notifier');
const safeRedirect = require('../lib/safeRedirect');

// Self-service portal for merchants. Sessions are short-lived JWTs scoped to "portal".
const router = express.Router();

function issue(account) {
  return jsonwebtoken.sign({ sub: account.id, aud: 'portal' }, config.jwt.secret, { algorithm: 'HS256', expiresIn: '30m' });
}

function requireCustomer(req, res, next) {
  const header = req.get('authorization') || '';
  if (header.startsWith('ApiKey ')) {
    const accountId = accounts.verifyApiKey(header.slice(7));
    if (!accountId) return res.status(401).json({ error: 'unauthorized' });
    req.accountId = accountId;
    return next();
  }
  try {
    const claims = jsonwebtoken.verify(header.replace(/^Bearer /, ''), config.jwt.secret, { algorithms: ['HS256'], audience: 'portal' });
    req.accountId = claims.sub;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

const password = Joi.string().min(12).max(200).required();

router.post(
  '/register',
  celebrate({ [Segments.BODY]: Joi.object({ email: Joi.string().email().required(), password }) }),
  async (req, res, next) => {
    try {
      const account = await accounts.register(req.body.email, req.body.password);
      res.status(201).json({ account, token: issue(account) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/login',
  celebrate({
    [Segments.BODY]: Joi.object({ email: Joi.string().required(), password: Joi.string().required() }),
    [Segments.QUERY]: Joi.object({ next: Joi.string().max(500) }),
  }),
  async (req, res, next) => {
    try {
      const account = await accounts.authenticate(req.body.email, req.body.password);
      if (!account) return res.status(401).json({ error: 'invalid_credentials' });
      return res.json({ token: issue(account), redirectTo: safeRedirect(req.query.next) });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  '/password-reset',
  celebrate({ [Segments.BODY]: Joi.object({ email: Joi.string().required() }) }),
  async (req, res, next) => {
    try {
      const { token, delivered } = accounts.requestPasswordReset(req.body.email);
      if (delivered) await notifier.sendPasswordReset(req.body.email, token);
      // Same response either way so this endpoint can't be used to enumerate accounts.
      res.status(202).json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/password-reset/confirm',
  celebrate({ [Segments.BODY]: Joi.object({ token: Joi.string().max(100).required(), password }) }),
  async (req, res, next) => {
    try {
      const ok = await accounts.resetPassword(req.body.token, req.body.password);
      res.status(ok ? 204 : 400).json(ok ? undefined : { error: 'invalid_or_expired_token' });
    } catch (err) {
      next(err);
    }
  }
);

router.use(requireCustomer);

router.patch(
  '/profile',
  celebrate({
    [Segments.BODY]: Joi.object({ name: Joi.string().max(120), phone: Joi.string().max(32), company: Joi.string().max(120), defaultCountry: Joi.string().length(2) }),
  }),
  (req, res, next) => {
    try {
      const profile = accounts.updateProfile(req.accountId, req.body);
      if (!profile) return res.status(404).json({ error: 'not_found' });
      return res.json(profile);
    } catch (err) {
      return next(err);
    }
  }
);

router.post('/api-keys', celebrate({ [Segments.BODY]: Joi.object({ label: Joi.string().max(60).required() }) }), (req, res) => {
  res.status(201).json(accounts.createApiKey(req.accountId, req.body.label));
});

router.delete('/api-keys/:prefix', celebrate({ [Segments.PARAMS]: Joi.object({ prefix: Joi.string().hex().length(8) }) }), (req, res) => {
  res.status(accounts.revokeApiKey(req.accountId, req.params.prefix) ? 204 : 404).end();
});

router.post(
  '/webhooks',
  celebrate({ [Segments.BODY]: Joi.object({ url: Joi.string().uri({ scheme: ['https'] }).required(), events: Joi.array().items(Joi.string()) }) }),
  async (req, res, next) => {
    try {
      const sub = await outbound.subscribe(req.accountId, req.body, { lookup: req.app.locals.dnsLookup });
      res.status(201).json(sub);
    } catch (err) {
      next(err);
    }
  }
);

router.get('/webhooks', (req, res) => res.json({ data: outbound.list(req.accountId) }));

router.post('/imports', express.text({ type: 'text/csv', limit: '512kb' }), (req, res, next) => {
  try {
    if (typeof req.body !== 'string') return res.status(415).json({ error: 'expected text/csv' });
    const result = csvImport.importOrders(req.body);
    return res.status(result.created.length ? 201 : 422).json(result);
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/orders/:reference/notes',
  celebrate({ [Segments.BODY]: Joi.object({ text: Joi.string().max(notes.MAX_LENGTH).required() }) }),
  (req, res, next) => {
    if (!orders.get(req.params.reference)) return res.status(404).json({ error: 'not_found' });
    try {
      return res.status(201).json(notes.add(req.params.reference, req.accountId, req.body.text));
    } catch (err) {
      return next(err);
    }
  }
);

router.get('/orders/:reference/notes', (req, res) => {
  if (!orders.get(req.params.reference)) return res.status(404).json({ error: 'not_found' });
  const list = notes.list(req.params.reference);
  if (req.accepts(['json', 'html']) === 'html') return res.render('notes', { reference: req.params.reference, notes: list });
  return res.json({ data: list });
});

const searchDefinition = Joi.object({
  filters: Joi.object().pattern(Joi.string().valid(...Object.keys(savedSearches.FILTERS)), Joi.alternatives(Joi.string().max(64), Joi.number())),
  sort: Joi.string().valid(...Object.keys(savedSearches.SORTS)),
  limit: Joi.number().integer().min(1).max(500),
});

router.post(
  '/searches',
  celebrate({ [Segments.BODY]: Joi.object({ name: Joi.string().max(80).required(), definition: searchDefinition.required() }) }),
  (req, res) => {
    res.status(201).json(savedSearches.save(req.accountId, req.body.name, req.body.definition));
  }
);

router.get('/searches/:id/sql', (req, res) => {
  const s = savedSearches.get(req.accountId, req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  return res.json({ sql: savedSearches.buildQuery(req.accountId, s.definition) });
});

module.exports = router;
