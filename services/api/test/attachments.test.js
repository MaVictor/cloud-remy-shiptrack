const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { request, app, login, sampleOrder } = require('./helpers');
const config = require('../src/config');

after(() => fs.rmSync(config.uploadDir, { recursive: true, force: true }));

test('uploads attachments with multer and lists them with glob', async () => {
  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };
  const { body: order } = await request(app).post('/api/orders').set(auth).send(sampleOrder);

  const res = await request(app)
    .post(`/api/orders/${order.reference}/attachments`)
    .set(auth)
    .attach('files', Buffer.from('%PDF-1.4 customs'), 'customs declaration.pdf')
    .attach('files', Buffer.from('packing list'), 'packing-list.txt');

  assert.equal(res.status, 201);
  assert.deepEqual(res.body.uploaded, ['customs_declaration.pdf', 'packing-list.txt']);
  assert.deepEqual(res.body.files, ['customs_declaration.pdf', 'packing-list.txt']);

  const list = await request(app).get(`/api/orders/${order.reference}/attachments`).set(auth);
  assert.deepEqual(list.body.files, ['customs_declaration.pdf', 'packing-list.txt']);
});

test('rejects uploads over the size limit', async () => {
  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };
  const { body: order } = await request(app).post('/api/orders').set(auth).send(sampleOrder);
  const res = await request(app)
    .post(`/api/orders/${order.reference}/attachments`)
    .set(auth)
    .attach('files', Buffer.alloc(6 * 1024 * 1024), 'huge.bin');
  assert.equal(res.status, 413);
});
