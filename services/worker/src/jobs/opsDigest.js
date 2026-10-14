const moment = require('moment');
const _ = require('lodash');
const mailer = require('../lib/mailer');
const { serviceClient } = require('../lib/http');

// Morning email to ops: orders stuck in transit and yesterday's volume by country.
function buildDigest(orders, now = new Date()) {
  const stuckCutoff = moment(now).subtract(5, 'days');
  const stuck = orders.filter((o) => o.status === 'in_transit' && moment(o.updatedAt || o.createdAt).isBefore(stuckCutoff));
  const yesterday = moment(now).subtract(1, 'day');
  const shippedYesterday = orders.filter((o) => moment(o.createdAt).isSame(yesterday, 'day'));
  const byCountry = _.countBy(shippedYesterday, 'destination.country');
  return {
    body: {
      title: `Ops digest for ${moment(now).format('ddd D MMM YYYY')}`,
      intro: [`${shippedYesterday.length} orders were created yesterday.`, `${stuck.length} shipments have been in transit for more than 5 days.`],
      table: [
        {
          title: 'Stuck shipments',
          data: _.sortBy(stuck, 'updatedAt').map((o) => ({
            reference: o.reference,
            tracking: o.trackingNumber || '-',
            since: moment(o.updatedAt || o.createdAt).fromNow(),
          })),
        },
        {
          title: 'Yesterday by country',
          data: _.map(byCountry, (count, country) => ({ country, orders: count })),
        },
      ],
      outro: 'Reply to this email to reach the on-call fulfilment lead.',
    },
  };
}

async function run({ config, api = serviceClient(config.apiUrl, 'orders:read'), now = new Date() }) {
  const { data } = await api.get('/api/orders', { params: { limit: 200 } });
  const email = buildDigest(data.data, now);
  await mailer.send({ to: config.opsRecipients, subject: email.body.title, email });
  return { orders: data.data.length };
}

module.exports = { name: 'ops-digest', at: '07:00', run, buildDigest };
