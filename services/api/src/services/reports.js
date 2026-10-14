const mysql = require('mysql2');
const moment = require('moment');
const _ = require('lodash');

// Reporting runs against the analytics replica (MySQL). Queries are built here and
// executed by the warehouse job; the API only needs the SQL and the in-memory rollups.
function shipmentsByDayQuery({ from, to, country }) {
  const start = moment.utc(from).startOf('day').format('YYYY-MM-DD HH:mm:ss');
  const end = moment.utc(to).endOf('day').format('YYYY-MM-DD HH:mm:ss');
  const clauses = ['shipped_at BETWEEN ? AND ?'];
  const params = [start, end];
  if (country) {
    clauses.push('destination_country = ?');
    params.push(country);
  }
  return mysql.format(
    `SELECT DATE(shipped_at) AS day, COUNT(*) AS shipments FROM ?? WHERE ${clauses.join(' AND ')} GROUP BY day ORDER BY day`,
    ['shipments', ...params]
  );
}

function dailyRollup(orders) {
  const byDay = _.groupBy(orders, (o) => moment.utc(o.createdAt).format('YYYY-MM-DD'));
  return _.map(byDay, (rows, day) => ({
    day,
    orders: rows.length,
    revenue: _.round(_.sumBy(rows, (o) => o.total || 0), 2),
    countries: _.uniq(rows.map((o) => o.destination.country)).sort(),
  })).sort((a, b) => a.day.localeCompare(b.day));
}

function createPool(url) {
  return mysql.createPool({ uri: url, connectionLimit: 5, waitForConnections: true });
}

module.exports = { shipmentsByDayQuery, dailyRollup, createPool };
