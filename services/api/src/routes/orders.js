const express = require('express');
const { celebrate, Joi, Segments } = require('celebrate');
const multer = require('multer');
const orders = require('../services/orders');
const attachments = require('../services/attachments');
const notifier = require('../services/notifier');
const tracking = require('../services/tracking');
const labels = require('../services/labels');
const routing = require('../services/routing');
const customs = require('../services/customs');
const customsKeys = require('../services/customsKeys');
const notes = require('../services/notes');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, attachments.ensureOrderDir(req.params.reference)),
    filename: (req, file, cb) => cb(null, file.originalname.replace(/[^\w.-]/g, '_')),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});

const itemSchema = Joi.object({
  sku: Joi.string().uppercase().required(),
  quantity: Joi.number().integer().min(1).required(),
  unitPrice: Joi.number().min(0).required(),
});

router.use(requireAuth);

/**
 * @openapi
 * /api/orders:
 *   get:
 *     summary: List orders
 *     tags: [orders]
 */
router.get(
  '/',
  celebrate({
    [Segments.QUERY]: Joi.object({
      status: Joi.string().valid('pending', 'label_created', 'in_transit', 'delivered', 'cancelled'),
      limit: Joi.number().integer().min(1).max(200).default(50),
    }),
  }),
  (req, res) => {
    res.json({ data: orders.list(req.query) });
  }
);

/**
 * @openapi
 * /api/orders:
 *   post:
 *     summary: Create an order
 *     tags: [orders]
 */
router.post(
  '/',
  celebrate({
    [Segments.BODY]: Joi.object({
      customerEmail: Joi.string().email().required(),
      destination: Joi.object({
        country: Joi.string().length(2).uppercase().required(),
        postcode: Joi.string().max(16).required(),
      }).required(),
      items: Joi.array().items(itemSchema).min(1).required(),
    }),
  }),
  (req, res, next) => {
    try {
      const order = orders.create(req.body);
      res.status(201).json(order);
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:reference', (req, res) => {
  const order = orders.get(req.params.reference);
  if (!order) return res.status(404).json({ error: 'not_found' });
  return res.json(order);
});

/**
 * @openapi
 * /api/orders/{reference}/ship:
 *   post:
 *     summary: Mark an order as shipped and notify the customer
 *     tags: [orders]
 */
router.post(
  '/:reference/ship',
  celebrate({ [Segments.BODY]: Joi.object({ trackingNumber: Joi.string().alphanum().min(8).required() }) }),
  async (req, res, next) => {
    try {
      const order = orders.update(req.params.reference, { status: 'in_transit', trackingNumber: req.body.trackingNumber });
      if (!order) return res.status(404).json({ error: 'not_found' });
      await notifier.sendShippedNotification(order);
      tracking.broadcast({ type: 'order.shipped', reference: order.reference, trackingNumber: order.trackingNumber });
      return res.json(order);
    } catch (err) {
      return next(err);
    }
  }
);

router.post('/:reference/attachments', upload.array('files'), async (req, res, next) => {
  try {
    if (!orders.get(req.params.reference)) return res.status(404).json({ error: 'not_found' });
    const files = await attachments.listAttachments(req.params.reference);
    return res.status(201).json({ uploaded: req.files.map((f) => f.filename), files });
  } catch (err) {
    return next(err);
  }
});

router.get('/:reference/attachments', async (req, res, next) => {
  try {
    res.json({ files: await attachments.listAttachments(req.params.reference) });
  } catch (err) {
    next(err);
  }
});

router.get('/:reference/notes', (req, res) => {
  if (!orders.get(req.params.reference)) return res.status(404).json({ error: 'not_found' });
  return res.json({ data: notes.list(req.params.reference) });
});

router.post(
  '/:reference/notes',
  celebrate({ [Segments.BODY]: Joi.object({ text: Joi.string().max(notes.MAX_LENGTH).required() }) }),
  (req, res, next) => {
    if (!orders.get(req.params.reference)) return res.status(404).json({ error: 'not_found' });
    try {
      return res.status(201).json(notes.add(req.params.reference, req.user.email, req.body.text));
    } catch (err) {
      return next(err);
    }
  }
);

router.get('/:reference/label', (req, res, next) => {
  if (!orders.get(req.params.reference)) return res.status(404).json({ error: 'not_found' });
  return labels.streamLabel(req, res, req.params.reference, next);
});

/**
 * @openapi
 * /api/orders/{reference}/plan:
 *   get:
 *     summary: Which warehouse fulfils each line item
 *     tags: [orders]
 */
router.get('/:reference/plan', (req, res) => {
  const order = orders.get(req.params.reference);
  if (!order) return res.status(404).json({ error: 'not_found' });
  return res.json({ reference: order.reference, plan: routing.planShipment(order) });
});

/**
 * @openapi
 * /api/orders/{reference}/customs:
 *   post:
 *     summary: Generate the signed customs declaration for a non-domestic order
 *     tags: [orders]
 */
router.post('/:reference/customs', (req, res) => {
  const order = orders.get(req.params.reference);
  if (!order) return res.status(404).json({ error: 'not_found' });
  const xml = customs.buildDeclaration(order, { eori: config.customs.eori, name: config.customs.traderName });
  res.type('application/xml').send(customs.sign(xml, customsKeys.privateKey()));
});

module.exports = router;
