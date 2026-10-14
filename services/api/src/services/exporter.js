const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const ejs = require('ejs');
const moment = require('moment');

const CSV_TEMPLATE = `reference,status,customer,country,total,created
<% orders.forEach(function (o) { %><%- [o.reference, o.status, o.customerEmail, o.destination.country, (o.total || 0).toFixed(2), o.createdAt].join(',') %>
<% }) %>`;

function writeExport(rootDir, orders, now = new Date()) {
  const dir = path.join(rootDir, moment(now).format('YYYY-MM-DD'));
  mkdirp.sync(dir);
  const file = path.join(dir, `orders-${moment(now).format('HHmmss')}.csv`);
  fs.writeFileSync(file, ejs.render(CSV_TEMPLATE, { orders }));
  return file;
}

// Remove export folders older than `keepDays`.
function pruneExports(rootDir, keepDays, now = new Date()) {
  if (!fs.existsSync(rootDir)) return Promise.resolve([]);
  const cutoff = moment(now).subtract(keepDays, 'days').startOf('day');
  const stale = fs
    .readdirSync(rootDir)
    .filter((d) => moment(d, 'YYYY-MM-DD', true).isValid() && moment(d, 'YYYY-MM-DD').isBefore(cutoff));
  return Promise.all(
    stale.map(
      (d) =>
        new Promise((resolve, reject) => {
          rimraf(path.join(rootDir, d), (err) => (err ? reject(err) : resolve(d)));
        })
    )
  );
}

module.exports = { writeExport, pruneExports };
