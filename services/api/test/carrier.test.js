const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const multer = require('multer');
const carrier = require('../src/services/carrier');

let server;
let baseURL;
const received = [];

before(async () => {
  const stub = express();
  stub.post('/v2/labels', multer().single('customs'), (req, res) => {
    received.push({ fields: req.body, file: req.file, apiKey: req.get('x-api-key') });
    res.json({ trackingNumber: `TRK${req.body.reference}`, labelUrl: 'https://labels.example.com/1.pdf' });
  });
  stub.get('/v2/tracking/:id', (req, res) => {
    res.json({ events: [{ code: 'PICKED_UP', id: req.params.id }] });
  });
  await new Promise((resolve) => {
    server = stub.listen(0, resolve);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const order = {
  reference: 'ST-ABCDEF12',
  destination: { country: 'DE', postcode: '10115' },
  items: [{ sku: 'BOX-SMALL', quantity: 3, unitPrice: 1 }],
};

test('requests a label as multipart with a customs document', async () => {
  const label = await carrier.createLabel(order, { baseURL, customsDoc: Buffer.from('%PDF-1.4') });
  assert.equal(label.trackingNumber, 'TRKST-ABCDEF12');
  assert.equal(received.length, 1);
  assert.equal(received[0].fields.country, 'DE');
  assert.deepEqual(JSON.parse(received[0].fields.parcels), [{ sku: 'BOX-SMALL', qty: 3 }]);
  assert.equal(received[0].file.originalname, 'customs.pdf');
  assert.equal(received[0].file.mimetype, 'application/pdf');
});

test('fetches tracking events', async () => {
  const events = await carrier.getTrackingEvents('1Z 999', { baseURL });
  assert.deepEqual(events, [{ code: 'PICKED_UP', id: '1Z 999' }]);
});
