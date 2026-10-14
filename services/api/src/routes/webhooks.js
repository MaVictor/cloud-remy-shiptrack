const express = require('express');
const { formidable } = require('formidable');
const jp = require('jsonpath');
const orders = require('../services/orders');
const tracking = require('../services/tracking');
const attachments = require('../services/attachments');

const router = express.Router();

// Each carrier nests tracking events differently; these paths normalise them.
const EVENT_PATHS = {
  dhl: '$.shipments[*].events[*]',
  ups: '$.trackResponse.shipment[*].package[*].activity[*]',
  default: '$..events[*]',
};

const STATUS_MAP = { DELIVERED: 'delivered', D: 'delivered', IN_TRANSIT: 'in_transit', I: 'in_transit', PICKED_UP: 'in_transit' };

function extractEvents(carrier, payload) {
  const events = jp.query(payload, EVENT_PATHS[carrier] || EVENT_PATHS.default);
  return events.map((e) => ({
    code: e.statusCode || e.code || (e.status && e.status.type),
    reference: e.shipmentReference || e.reference || jp.value(payload, '$..shipmentReference'),
    at: e.timestamp || e.date,
  }));
}

/**
 * @openapi
 * /webhooks/carriers/{carrier}:
 *   post:
 *     summary: Inbound tracking events from carriers (JSON)
 *     tags: [webhooks]
 */
router.post('/carriers/:carrier', express.json({ limit: '512kb' }), (req, res) => {
  const events = extractEvents(req.params.carrier, req.body);
  let applied = 0;
  for (const event of events) {
    const status = STATUS_MAP[event.code];
    if (status && event.reference && orders.update(event.reference, { status })) {
      tracking.broadcast({ type: 'order.status', reference: event.reference, status });
      applied += 1;
    }
  }
  res.json({ received: events.length, applied });
});

/**
 * @openapi
 * /webhooks/carriers/{carrier}/pod:
 *   post:
 *     summary: Proof-of-delivery photo upload (multipart)
 *     tags: [webhooks]
 */
router.post('/carriers/:carrier/pod', async (req, res, next) => {
  const form = formidable({ maxFileSize: 10 * 1024 * 1024, maxFiles: 1, keepExtensions: true });
  try {
    const [fields, files] = await form.parse(req);
    const reference = [].concat(fields.reference)[0];
    const photo = [].concat(files.photo)[0];
    if (!reference || !photo) return res.status(400).json({ error: 'reference_and_photo_required' });
    if (!orders.get(reference)) return res.status(404).json({ error: 'not_found' });

    const dir = attachments.ensureOrderDir(reference);
    require('fs').copyFileSync(photo.filepath, require('path').join(dir, `pod-${req.params.carrier}.jpg`));
    orders.update(reference, { status: 'delivered' });
    return res.status(201).json({ reference, stored: `pod-${req.params.carrier}.jpg`, bytes: photo.size });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.extractEvents = extractEvents;
