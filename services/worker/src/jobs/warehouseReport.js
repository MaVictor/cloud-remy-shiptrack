const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const ejs = require('ejs');
const moment = require('moment');
const mailer = require('../lib/mailer');

const template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'warehouse-report.ejs'), 'utf8');

function weeklyQuery(weekOf) {
  const start = moment.utc(weekOf).startOf('isoWeek');
  return mysql.format(
    'SELECT warehouse, SUM(picked) AS picked, SUM(shipped) AS shipped, AVG(pick_minutes) AS avgPickMinutes FROM ?? WHERE day >= ? AND day < ? GROUP BY warehouse ORDER BY warehouse',
    ['warehouse_daily', start.format('YYYY-MM-DD'), start.clone().add(7, 'days').format('YYYY-MM-DD')]
  );
}

function render(weekOf, rows) {
  return ejs.render(template, { weekOf: moment.utc(weekOf).startOf('isoWeek').format('D MMM YYYY'), rows });
}

function query(url, sql) {
  const conn = mysql.createConnection({ uri: url });
  return new Promise((resolve, reject) => {
    conn.query(sql, (err, rows) => {
      conn.end();
      return err ? reject(err) : resolve(rows.map((r) => ({ ...r, avgPickMinutes: Number(r.avgPickMinutes) })));
    });
  });
}

async function run({ config, now = new Date(), fetch = query }) {
  if (!config.analyticsUrl) return { skipped: 'ANALYTICS_MYSQL_URL not set' };
  const weekOf = moment(now).subtract(7, 'days').toDate();
  const rows = await fetch(config.analyticsUrl, weeklyQuery(weekOf));
  await mailer.send({ to: config.opsRecipients, subject: 'Weekly warehouse throughput', html: render(weekOf, rows) });
  return { warehouses: rows.length };
}

module.exports = { name: 'warehouse-report', at: 'Mon 08:00', run, weeklyQuery, render };
