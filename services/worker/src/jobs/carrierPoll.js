const jp = require('jsonpath');
const _ = require('lodash');
const { serviceClient } = require('../lib/http');

// Carriers without webhooks get polled. The gateway normalises auth; we normalise events.
const TERMINAL = new Set(['delivered', 'cancelled']);
const CODES = { DL: 'delivered', DELIVERED: 'delivered', IT: 'in_transit', IN_TRANSIT: 'in_transit', OD: 'in_transit', RS: 'cancelled' };

function latestStatus(trackingPayload) {
  const events = jp.query(trackingPayload, '$..events[*]');
  const latest = _.maxBy(events, (e) => Date.parse(e.timestamp || e.at || 0));
  return latest ? CODES[latest.code] || null : null;
}

async function run({ config, api = serviceClient(config.apiUrl, 'orders:write'), gateway = serviceClient(config.gatewayUrl, 'tracking:read') }) {
  const { data } = await api.get('/api/orders', { params: { status: 'in_transit', limit: 200 } });
  const results = { checked: 0, updated: 0, errors: 0 };
  for (const chunk of _.chunk(data.data.filter((o) => o.trackingNumber), 10)) {
    await Promise.all(
      chunk.map(async (order) => {
        results.checked += 1;
        try {
          const res = await gateway.get(`/v1/tracking/${encodeURIComponent(order.trackingNumber)}`);
          const status = latestStatus(res.data);
          if (status && status !== order.status && !TERMINAL.has(order.status)) {
            await api.post('/webhooks/carriers/poller', { events: [{ code: status.toUpperCase(), reference: order.reference }] });
            results.updated += 1;
          }
        } catch (err) {
          results.errors += 1;
        }
      })
    );
  }
  return results;
}

module.exports = { name: 'carrier-poll', every: '10m', run, latestStatus };
