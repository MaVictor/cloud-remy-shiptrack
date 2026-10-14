require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');
const xpath = require('xpath');
const dhl = require('../src/carriers/dhl');
const ups = require('../src/carriers/ups');
const postnord = require('../src/carriers/postnord');

let server;
let baseURL;
const seen = [];
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

before(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use(express.text({ type: ['text/xml', 'application/x-www-form-urlencoded'] }));
  stub.use((req, res, next) => {
    seen.push({ url: req.url, headers: req.headers, body: req.body });
    next();
  });
  stub.post('/rates', (req, res) =>
    res.json({ products: [{ productName: 'EXPRESS WORLDWIDE', totalPrice: [{ price: '42.10', priceCurrency: 'EUR' }], deliveryCapabilities: { estimatedDeliveryDateAndTime: '2026-03-03T12:00:00Z' } }] })
  );
  stub.post('/shipments', (req, res) => res.json({ shipmentTrackingNumber: '1234567890', documents: [{ url: 'https://dhl/label.pdf' }] }));
  stub.get('/track/shipments', (req, res) =>
    res.json({ shipments: [{ events: [{ statusCode: 'transit', timestamp: '2026-03-02T10:00:00Z', location: { address: { addressLocality: 'Leipzig' } } }] }] })
  );
  stub.post('/security/v1/oauth/token', (req, res) => res.json({ access_token: 'ups-token', expires_in: '3600' }));
  stub.post('/api/rating/v2403/Shop', (req, res) =>
    res.json({ RateResponse: { RatedShipment: [{ Service: { Description: 'UPS Standard' }, TotalCharges: { MonetaryValue: '18.50', CurrencyCode: 'EUR' }, GuaranteedDelivery: { BusinessDaysInTransit: '3' } }] } })
  );
  stub.get('/api/track/v1/details/:n', (req, res) =>
    res.json({ trackResponse: { shipment: [{ package: [{ activity: [{ status: { type: 'D' }, date: '20260303', time: '101500', location: { address: { city: 'Malmo' } } }] }] }] } })
  );
  stub.post('/b2b/v3', (req, res) => {
    res.type('text/xml').send(
      '<Envelope><Body><Prices><Price service="MyPack Home" amount="9.90" currency="SEK" deliveryBy="2026-03-04"/></Prices><ItemId>RR123456789SE</ItemId><Event code="IT" at="2026-03-02T08:00:00Z" location="Stockholm"/></Body></Envelope>'
    );
  });
  await new Promise((r) => {
    server = stub.listen(0, r);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const shipment = { reference: 'ST-ABCDEF12', from: { country: 'GB' }, to: { country: 'SE' }, weightKg: 2, shipDate: '2026-03-01' };

test('dhl quotes, labels (multipart on API >= 2.2) and tracks', async () => {
  const c = dhl({ baseURL, apiKey: 'k', apiVersion: '2.3.1' });
  const [quote] = await c.quote(shipment);
  assert.deepEqual(quote, { carrier: 'dhl', service: 'EXPRESS WORLDWIDE', price: 42.1, currency: 'EUR', deliveryBy: '2026-03-03T12:00:00.000Z' });
  assert.equal(seen.at(-1).headers['dhl-api-key'], 'k');
  assert.equal(seen.at(-1).body.plannedShippingDate, '2026-03-01');

  assert.deepEqual(await c.label(shipment), { trackingNumber: '1234567890', labelUrl: 'https://dhl/label.pdf' });
  assert.match(seen.at(-1).headers['content-type'], /^multipart\/form-data/);
  await dhl({ baseURL, apiKey: 'k', apiVersion: 'v2.1' }).label(shipment);
  assert.match(seen.at(-1).headers['content-type'], /^application\/json/);

  assert.deepEqual(await c.track('1234567890'), [{ code: 'TRANSIT', timestamp: '2026-03-02T10:00:00Z', location: 'Leipzig' }]);
});

test('ups fetches and caches an oauth token', async () => {
  seen.length = 0;
  const c = ups({ baseURL, clientId: 'id', clientSecret: 'secret' });
  const [quote] = await c.quote(shipment);
  assert.equal(quote.price, 18.5);
  assert.equal(quote.deliveryBy.slice(0, 10), '2026-03-04');
  const events = await c.track('1Z999AA10123456784');
  assert.deepEqual(events.map((e) => [e.code, e.location]), [['DL', 'Malmo']]);
  assert.equal(seen.filter((s) => s.url === '/security/v1/oauth/token').length, 1);
  assert.equal(seen.find((s) => s.url === '/security/v1/oauth/token').headers.authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);
  assert.equal(seen.at(-1).headers.authorization, 'Bearer ups-token');
});

test('postnord signs SOAP bodies and parses XML responses', async () => {
  seen.length = 0;
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const c = postnord({ baseURL, privateKey });
  const [quote] = await c.quote(shipment);
  assert.deepEqual(quote, { carrier: 'postnord', service: 'MyPack Home', price: 9.9, currency: 'SEK', deliveryBy: '2026-03-04' });
  assert.equal(seen[0].headers.soapaction, 'urn:postnord:b2b:v3#GetPrices');

  const sent = seen[0].body;
  const doc = new DOMParser().parseFromString(sent, 'text/xml');
  const sigNode = xpath.select("//*[local-name(.)='Signature']", doc)[0];
  const verifier = new SignedXml({ publicCert: pair.publicKey.export({ type: 'spki', format: 'pem' }) });
  verifier.loadSignature(sigNode);
  assert.equal(verifier.checkSignature(sent), true);

  assert.deepEqual(await c.label(shipment), { trackingNumber: 'RR123456789SE', labelUrl: '' });
  assert.deepEqual(await c.track('RR123456789SE'), [{ code: 'IT', timestamp: '2026-03-02T08:00:00Z', location: 'Stockholm' }]);
});
