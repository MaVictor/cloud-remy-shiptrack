const { test } = require('node:test');
const assert = require('node:assert/strict');
const reports = require('../src/services/reports');
const { request, app, login } = require('./helpers');

test('builds escaped warehouse SQL for a date window', () => {
  const sql = reports.shipmentsByDayQuery({ from: '2026-03-01', to: '2026-03-07', country: "GB' OR 1=1 --" });
  assert.equal(
    sql,
    "SELECT DATE(shipped_at) AS day, COUNT(*) AS shipments FROM `shipments` WHERE shipped_at BETWEEN '2026-03-01 00:00:00' AND '2026-03-07 23:59:59' AND destination_country = 'GB\\' OR 1=1 --' GROUP BY day ORDER BY day"
  );
});

test('rolls orders up by UTC day', () => {
  const rollup = reports.dailyRollup([
    { createdAt: '2026-03-01T23:30:00Z', total: 10.005, destination: { country: 'GB' } },
    { createdAt: '2026-03-01T01:00:00Z', total: 5, destination: { country: 'DE' } },
    { createdAt: '2026-03-02T09:00:00Z', total: 7.5, destination: { country: 'GB' } },
  ]);
  assert.deepEqual(rollup, [
    { day: '2026-03-01', orders: 2, revenue: 15.01, countries: ['DE', 'GB'] },
    { day: '2026-03-02', orders: 1, revenue: 7.5, countries: ['GB'] },
  ]);
});

test('admin report endpoint validates the window', async () => {
  const admin = await login('ops@shiptrack.example.com', 'correct-horse');
  const auth = { Authorization: `Bearer ${admin}` };
  const ok = await request(app).get('/api/admin/reports/daily?from=2026-03-01&to=2026-03-02').set(auth);
  assert.equal(ok.status, 200);
  assert.match(ok.body.sql, /BETWEEN '2026-03-01 00:00:00' AND '2026-03-02 23:59:59'/);
  const bad = await request(app).get('/api/admin/reports/daily?from=2026-03-02&to=2026-03-01').set(auth);
  assert.equal(bad.status, 400);
});

test('creates a pool without connecting', async () => {
  const pool = reports.createPool('mysql://reader:secret@127.0.0.1:3306/analytics');
  assert.equal(typeof pool.query, 'function');
  await new Promise((resolve) => pool.end(resolve));
});
