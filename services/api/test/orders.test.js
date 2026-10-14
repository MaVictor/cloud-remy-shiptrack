const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, login, sampleOrder } = require('./helpers');
const orders = require('../src/services/orders');
const notifier = require('../src/services/notifier');

beforeEach(() => orders.clear());

test('creates an order with a reference, total and lowercased email', async () => {
  const token = await login();
  const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send(sampleOrder);
  assert.equal(res.status, 201);
  assert.match(res.body.reference, /^ST-[0-9A-F]{8}$/);
  assert.equal(res.body.customerEmail, 'jamie@example.com');
  assert.equal(res.body.status, 'pending');
  assert.equal(res.body.total, 12);
});

test('rejects malformed payloads at the edge', async () => {
  const token = await login();
  const res = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...sampleOrder, items: [] });
  assert.equal(res.status, 400);
});

test('model validation catches what Joi lets through', async () => {
  const token = await login();
  const res = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...sampleOrder, destination: { country: 'ZZ', postcode: '1' } });
  assert.equal(res.status, 422);
  assert.deepEqual(res.body.fields, ['destination.country']);
});

test('lists and filters orders', async () => {
  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };
  await request(app).post('/api/orders').set(auth).send(sampleOrder);
  const created = await request(app).post('/api/orders').set(auth).send(sampleOrder);
  orders.update(created.body.reference, { status: 'delivered' });

  const all = await request(app).get('/api/orders').set(auth);
  assert.equal(all.body.data.length, 2);
  const delivered = await request(app).get('/api/orders?status=delivered').set(auth);
  assert.equal(delivered.body.data.length, 1);
  assert.equal((await request(app).get('/api/orders?status=lost').set(auth)).status, 400);
});

test('shipping an order emails the customer', async () => {
  const sent = [];
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const original = transport.sendMail.bind(transport);
  transport.sendMail = async (msg) => {
    const info = await original(msg);
    sent.push(JSON.parse(info.message));
    return info;
  };
  notifier.setTransport(transport);

  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };
  const created = await request(app).post('/api/orders').set(auth).send(sampleOrder);
  const res = await request(app)
    .post(`/api/orders/${created.body.reference}/ship`)
    .set(auth)
    .send({ trackingNumber: '1Z999AA10123456784' });

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'in_transit');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0].address, 'jamie@example.com');
  assert.match(sent[0].subject, /has shipped/);
  assert.match(sent[0].html, /Track my order/);
  assert.match(sent[0].html, /BOX-SMALL/);
  assert.match(sent[0].text, /is on its way/);
});

test('agents can add and read notes on an order', async () => {
  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };
  const created = await request(app).post('/api/orders').set(auth).send(sampleOrder);
  const res = await request(app).post(`/api/orders/${created.body.reference}/notes`).set(auth).send({ text: 'Customer asked for Saturday delivery' });
  assert.equal(res.status, 201);
  assert.equal(res.body.author, 'dana@shiptrack.example.com');
  const list = await request(app).get(`/api/orders/${created.body.reference}/notes`).set(auth);
  assert.deepEqual(list.body.data.map((n) => n.body), ['Customer asked for Saturday delivery']);
  assert.equal((await request(app).post(`/api/orders/${created.body.reference}/notes`).set(auth).send({ text: '' })).status, 400);
});
