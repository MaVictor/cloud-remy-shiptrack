process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { Scheduler, parseEvery, nextRun } = require('../src/scheduler');
const { createHealthApp } = require('../src/health');
const { main } = require('../src/index');

test('parses intervals', () => {
  assert.equal(parseEvery('15m'), 900000);
  assert.equal(parseEvery('2h'), 7200000);
  assert.throws(() => parseEvery('soon'));
});

test('computes the next daily and weekly run', () => {
  const now = new Date(2026, 2, 4, 9, 0); // Wed 4 Mar 2026, 09:00 local
  assert.deepEqual(nextRun('07:00', now), new Date(2026, 2, 5, 7, 0));
  assert.deepEqual(nextRun('10:30', now), new Date(2026, 2, 4, 10, 30));
  assert.deepEqual(nextRun('Mon 08:00', now), new Date(2026, 2, 9, 8, 0));
});

test('runOnce records success and failure', async () => {
  const runs = [];
  const s = new Scheduler({
    jobs: [
      { name: 'ok', run: async (ctx) => ({ seen: ctx.flag }) },
      { name: 'boom', run: async () => { throw new Error('nope'); } },
    ],
    context: { flag: 1 },
    onRun: (r) => runs.push(r),
  });
  assert.deepEqual((await s.runOnce('ok')).summary, { seen: 1 });
  const failed = await s.runOnce('boom');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'nope');
  assert.match(failed.runId, /^[0-9a-f-]{36}$/);
  await assert.rejects(() => s.runOnce('missing'), /unknown job/);
  assert.equal(runs.length, 2);
});

test('health app exposes the latest run per job', async () => {
  const history = [
    { job: 'b', status: 'failed', startedAt: new Date('2026-03-01T01:00:00Z') },
    { job: 'a', status: 'failed', startedAt: new Date('2026-03-01T01:00:00Z') },
    { job: 'a', status: 'succeeded', startedAt: new Date('2026-03-01T02:00:00Z') },
  ];
  const app = createHealthApp(history);
  assert.equal((await request(app).get('/healthz')).status, 200);
  const res = await request(app).get('/runs');
  assert.deepEqual(res.body.runs.map((r) => [r.job, r.status]), [['a', 'succeeded'], ['b', 'failed']]);
});

test('CLI runs a single job by name', async () => {
  const code = await main(['--run', 'erp-sync']);
  assert.equal(code, 0);
});
