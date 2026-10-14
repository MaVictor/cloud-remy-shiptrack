const express = require('express');
const { celebrate, Joi, Segments } = require('celebrate');
const orders = require('../services/orders');
const reports = require('../services/reports');
const erp = require('../integrations/erp');
const config = require('../config');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAdmin);

/**
 * @openapi
 * /api/admin/reports/daily:
 *   get:
 *     summary: Daily order rollup plus the warehouse SQL for the same window
 *     tags: [admin]
 */
router.get(
  '/reports/daily',
  celebrate({
    [Segments.QUERY]: Joi.object({
      from: Joi.date().iso().required(),
      to: Joi.date().iso().min(Joi.ref('from')).required(),
      country: Joi.string().length(2).uppercase(),
    }),
  }),
  (req, res) => {
    res.json({
      rollup: reports.dailyRollup(orders.list({ limit: 200 })),
      sql: reports.shipmentsByDayQuery(req.query),
    });
  }
);

router.get(
  '/stock',
  celebrate({ [Segments.QUERY]: Joi.object({ skus: Joi.string().pattern(/^[A-Z0-9-]+(,[A-Z0-9-]+)*$/).required() }) }),
  async (req, res, next) => {
    if (!config.erpUrl) return res.status(503).json({ error: 'erp_not_configured' });
    try {
      return res.json({ data: await erp.fetchStockLevels(config.erpUrl, req.query.skus.split(',')) });
    } catch (err) {
      return next(err);
    }
  }
);

router.get('/whoami', (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role });
});

module.exports = router;
