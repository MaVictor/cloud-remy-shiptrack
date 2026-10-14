const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const request = require('supertest');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');
const { token } = require('./helpers');
const { createApp } = require('../src/app');
const { Breaker, setTransport } = require('../src/lib/breaker');
const { memoryCache } = require('../src/lib/rateCache');
const { createStatusFeed } = require('../src/lib/statusFeed');
const { detectCarrier } = require('../src/routes/v1');

function fakeAdapter(name, { price = 10, fail = false } = {}) {
  return {
    name,
    quote: async () => {
      if (fail) throw new Error(`${name} down`);
      return [{ carrier: name, service: 'Standard', price, currency: 'EUR', deliveryBy: '2026-03-05T00:00:00.000Z' }];
    },
    label: async (s) => ({ trackingNumber: `${name.toUpperCase()}-${s.reference}`, labelUrl: `https://labels/${s.reference}.pdf` }),
    track: async () => [
      { code: 'DL', timestamp: '2026-03-03T10:00:00Z' },
      { code: 'IT', timestamp: '2026-03-02T10:00:00Z' },
    ],
  };
}

let cache;
let feed;
function app(overrides = {}) {
  const registry = {};
  for (const n of ['dhl', 'ups', 'postnord'])
    registry[n] = { adapter: overrides[n] || fakeAdapter(n), breaker: new Breaker(n, { threshold: 2 }) };
  return createApp({ registry, cache, statusFeed: feed });
}

const shipment = {
  from: { country: 'GB', postcode: 'EC1A 1BB' },
  to: { country: 'SE', postcode: '111 22' },
  weightKg: 2.5,
  shipDate: '2099-03-01',
};

beforeEach(() => {
  cache = memoryCache();
  feed = createStatusFeed();
});

test('requires a service token with the right scope', async () => {
  const a = app();
  assert.equal((await request(a).post('/v1/rates').send(shipment)).status, 401);
  assert.equal((await request(a).post('/v1/rates').set('Authorization', token('labels:write')).send(shipment)).status, 403);
  assert.equal((await request(a).post('/v1/rates').set('Authorization', token('rates:read', 'user:1')).send(shipment)).status, 401);
});

test('quotes all carriers cheapest first and caches the result', async () => {
  const a = app({
    dhl: fakeAdapter('dhl', { price: 14 }),
    ups: fakeAdapter('ups', { price: 9 }),
    postnord: fakeAdapter('postnord', { price: 11 }),
  });
  const first = await request(a).post('/v1/rates').set('Authorization', token('rates:read')).send(shipment);
  assert.equal(first.status, 200);
  assert.equal(first.headers['x-cache'], 'miss');
  assert.deepEqual(
    first.body.quotes.map((q) => q.carrier),
    ['ups', 'postnord', 'dhl'],
  );
  const second = await request(a).post('/v1/rates').set('Authorization', token('rates:read')).send(shipment);
  assert.equal(second.headers['x-cache'], 'hit');
});

test('a failing carrier is reported, not fatal', async () => {
  const a = app({ ups: fakeAdapter('ups', { fail: true }) });
  const res = await request(a).post('/v1/rates').set('Authorization', token('rates:read')).send(shipment);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.failed, ['ups']);
  assert.equal(res.body.quotes.length, 2);
});

test('validates rate requests', async () => {
  const a = app();
  const res = await request(a)
    .post('/v1/rates')
    .set('Authorization', token('rates:read'))
    .send({ ...shipment, weightKg: 500 });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.segments, ['body']);
});

test('buys labels and publishes to the live feed', async () => {
  const a = app();
  const server = http.createServer(a);
  feed.attach(server);
  await new Promise((r) => server.listen(0, r));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/v1/feed`);
  await new Promise((r) => ws.on('open', r));
  const message = new Promise((r) => ws.on('message', (d) => r(JSON.parse(d.toString()))));

  try {
    const res = await request(server)
      .post('/v1/labels')
      .set('Authorization', token('labels:write'))
      .send({ ...shipment, carrier: 'dhl', reference: 'ST-ABCDEF12', contactEmail: 'Jamie@Example.com' });
    assert.equal(res.status, 201);
    assert.equal(res.body.trackingNumber, 'DHL-ST-ABCDEF12');
    const event = await message;
    assert.equal(event.type, 'label.created');
    assert.match(event.id, /^[0-9a-f-]{36}$/);
  } finally {
    ws.terminate();
    await feed.close();
    await new Promise((r) => server.close(r));
  }
});

test('tracking detects the carrier and sorts events', async () => {
  const a = app();
  const res = await request(a).get('/v1/tracking/1Z999AA10123456784').set('Authorization', token('tracking:read'));
  assert.equal(res.status, 200);
  assert.equal(res.body.carrier, 'ups');
  assert.deepEqual(
    res.body.events.map((e) => e.code),
    ['IT', 'DL'],
  );
  assert.equal(detectCarrier('1234567890'), 'dhl');
  assert.equal(detectCarrier('RR123456789SE'), 'postnord');
  assert.equal((await request(a).get('/v1/tracking/nope').set('Authorization', token('tracking:read'))).status, 400);
});

test('circuit breaker opens after repeated failures and emails on-call once', async () => {
  const mails = [];
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const sendMail = transport.sendMail.bind(transport);
  transport.sendMail = async (m) => {
    const info = await sendMail(m);
    mails.push(JSON.parse(info.message));
    return info;
  };
  setTransport(transport);

  const b = new Breaker('ups', { threshold: 2, coolDownSeconds: 60 });
  const boom = () => Promise.reject(new Error('timeout'));
  await assert.rejects(() => b.call(boom));
  assert.equal(b.state, 'closed');
  await assert.rejects(() => b.call(boom));
  assert.equal(b.state, 'open');
  await assert.rejects(() => b.call(() => Promise.resolve(1)), /circuit open/);
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /ups circuit opened/);
});

test('openapi spec, docs and compression', async () => {
  const a = app();
  const spec = await request(a).get('/openapi.json');
  assert.ok(spec.body.paths['/v1/rates'].post);
  const docs = await request(a).get('/docs/').set('Accept-Encoding', 'gzip');
  assert.equal(docs.status, 200);
  assert.equal(docs.headers['content-encoding'], 'gzip');
});
