const minimatch = require('minimatch');

// Fulfilment routing: first matching rule wins. Patterns are SKU globs maintained by ops.
const DEFAULT_RULES = [
  { pattern: 'HAZ-*', warehouse: 'RTM-HAZMAT', countries: null },
  { pattern: 'COLD-*', warehouse: 'AMS-COLD', countries: null },
  { pattern: '{BOX,TAPE,WRAP}-*', warehouse: 'LON-01', countries: ['GB', 'IE'] },
  { pattern: '{BOX,TAPE,WRAP}-*', warehouse: 'BER-01', countries: null },
  { pattern: '*', warehouse: 'BER-01', countries: null },
];

function routeItem(sku, country, rules = DEFAULT_RULES) {
  const rule = rules.find(
    (r) => minimatch(sku, r.pattern, { nocase: true }) && (!r.countries || r.countries.includes(country))
  );
  return rule ? rule.warehouse : null;
}

function planShipment(order, rules) {
  const plan = {};
  for (const item of order.items) {
    const wh = routeItem(item.sku, order.destination.country, rules);
    (plan[wh] = plan[wh] || []).push(item.sku);
  }
  return plan;
}

module.exports = { routeItem, planShipment, DEFAULT_RULES };
