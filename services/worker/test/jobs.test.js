process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { SignedXml } = require('xml-crypto');
const config = require('../src/config');
const mailer = require('../src/lib/mailer');
const serviceToken = require('../src/lib/serviceToken');
const erpSync = require('../src/jobs/erpSync');
const carrierPoll = require('../src/jobs/carrierPoll');
const customsSubmit = require('../src/jobs/customsSubmit');
const opsDigest = require('../src/jobs/opsDigest');
const attachmentCleanup = require('../src/jobs/attachmentCleanup');
const warehouseReport = require('../src/jobs/warehouseReport');

const sent = [];
const transport = nodemailer.createTransport({ jsonTransport: true });
const sendMail = transport.sendMail.bind(transport);
transport.sendMail = async (msg) => {
  const info = await sendMail(msg);
  sent.push(JSON.parse(info.message));
  return info;
};
mailer.setTransport(transport);

let server;
let baseURL;
const calls = [];
before(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use((req, res, next) => {
    calls.push({ method: req.method, url: req.url, auth: req.get('authorization'), body: req.body });
    next();
  });
  stub.get('/api/orders', (req, res) =>
    res.json({
      data: [
        { reference: 'ST-1', status: 'in_transit', trackingNumber: 'TRK1', createdAt: '2026-02-20T10:00:00Z', updatedAt: '2026-02-21T10:00:00Z', destination: { country: 'GB' } },
        { reference: 'ST-2', status: 'in_transit', trackingNumber: 'TRK2', createdAt: '2026-02-28T09:00:00Z', updatedAt: '2026-02-28T12:00:00Z', destination: { country: 'DE' } },
        { reference: 'ST-3', status: 'pending', createdAt: '2026-02-28T15:00:00Z', destination: { country: 'GB' } },
      ],
    })
  );
  stub.get('/v1/tracking/:n', (req, res) =>
    res.json({
      trackingNumber: req.params.n,
      carrier: { events: [{ code: 'IT', timestamp: '2026-02-27T08:00:00Z' }, { code: req.params.n === 'TRK1' ? 'DL' : 'IT', timestamp: '2026-03-01T08:00:00Z' }] },
    })
  );
  stub.post('/webhooks/carriers/poller', (req, res) => res.json({ received: 1, applied: 1 }));
  stub.post('/v1/declarations', multer().single('document'), (req, res) =>
    res.json({ mrn: `26GB${req.body.reference}`, bytes: req.file.size, type: req.file.mimetype })
  );
  await new Promise((resolve) => {
    server = stub.listen(0, resolve);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('service tokens are scoped and verifiable', () => {
  const claims = serviceToken.verify(serviceToken.issue('orders:read'));
  assert.equal(claims.sub, 'svc:worker');
  assert.equal(claims.scope, 'orders:read');
  assert.throws(() => serviceToken.verify(serviceToken.issue('x').replace(/.$/, 'A')));
});

test('erp-sync turns ERP rows into deduplicated, validated upserts', async () => {
  const rows = [
    { sku: ' box-small ', warehouse_code: 'LON-01', on_hand: 10, reserved: 2 },
    { sku: 'BOX-SMALL', warehouse_code: 'LON-01', on_hand: 8, reserved: 1 },
    { sku: 'TAPE-50M', warehouse_code: 'BER-01', on_hand: 40, reserved: null },
    { sku: null, warehouse_code: 'BER-01', on_hand: 1 },
  ];
  let written;
  const summary = await erpSync.run({
    config: { erpUrl: 'mssql://u:p@erp:1433/erp' },
    since: new Date('2026-03-01'),
    fetch: async () => rows,
    write: async (ops) => {
      written = ops;
    },
  });
  assert.deepEqual(summary, { rows: 4, upserts: 2 });
  assert.deepEqual(written.map((o) => [o.updateOne.filter, o.updateOne.update.$set.onHand]), [
    [{ sku: 'TAPE-50M', warehouse: 'BER-01' }, 40],
    [{ sku: 'BOX-SMALL', warehouse: 'LON-01' }, 8],
  ]);
  assert.throws(() => erpSync.toBulkOps([{ sku: 'X', warehouse_code: 'W', on_hand: -1 }], new Date()), /invalid stock row/);
  assert.deepEqual(await erpSync.run({ config: { erpUrl: '' } }), { skipped: 'ERP_URL not set' });
});

test('erp-sync builds a parameterised delta query', () => {
  const req = erpSync.deltaRequest(new Date('2026-03-01T00:00:00Z'), () => {});
  assert.match(req.sqlTextOrProcedure, /modified_at > @since/);
  assert.equal(req.parameters[0].type.name, 'DateTime2');
  assert.equal(erpSync.connectionConfig('mssql://a%40b:pw@db.internal/stock').authentication.options.userName, 'a@b');
});

test('carrier-poll reads the newest event and pushes changes to the API', async () => {
  calls.length = 0;
  const summary = await carrierPoll.run({ config: { apiUrl: baseURL, gatewayUrl: baseURL } });
  assert.deepEqual(summary, { checked: 2, updated: 1, errors: 0 });
  const push = calls.find((c) => c.url === '/webhooks/carriers/poller');
  assert.deepEqual(push.body, { events: [{ code: 'DELIVERED', reference: 'ST-1' }] });
  assert.equal(serviceToken.verify(push.auth.replace('Bearer ', '')).scope, 'orders:write');
  assert.equal(carrierPoll.latestStatus({ events: [] }), null);
});

function signedDeclaration(privateKey, reference) {
  const xml = `<CustomsFiling xmlns="urn:shiptrack:customs:v1"><Declaration id="${reference}"><Quantity>2</Quantity></Declaration></CustomsFiling>`;
  const sig = new SignedXml({ privateKey });
  sig.addReference({
    xpath: "//*[local-name(.)='Declaration']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.computeSignature(xml);
  return sig.getSignedXml();
}

test('customs-submit verifies signatures and files valid declarations', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const good = signedDeclaration(privateKey, 'ST-GOOD');
  const tampered = signedDeclaration(privateKey, 'ST-BAD').replace('<Quantity>2</Quantity>', '<Quantity>9</Quantity>');
  const unsigned = '<CustomsFiling><Declaration id="ST-NONE"/></CustomsFiling>';

  const summary = await customsSubmit.run({
    config: { customsAuthorityUrl: baseURL },
    pending: [good, tampered, unsigned],
    publicKey,
    apiKey: 'test-key',
  });
  assert.deepEqual(summary.submitted, [{ reference: 'ST-GOOD', mrn: '26GBST-GOOD' }]);
  assert.deepEqual(summary.rejected, [
    { reference: 'ST-BAD', reason: 'bad_signature' },
    { reference: undefined, reason: 'unsigned' },
  ]);
  assert.equal(calls.filter((c) => c.url === '/v1/declarations').pop().auth, 'ApiKey test-key');
});

test('ops-digest flags stuck shipments and summarises yesterday', async () => {
  sent.length = 0;
  const summary = await opsDigest.run({
    config: { apiUrl: baseURL, opsRecipients: ['ops@shiptrack.example.com'] },
    now: new Date('2026-03-01T07:00:00Z'),
  });
  assert.deepEqual(summary, { orders: 3 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Ops digest for Sun 1 Mar 2026');
  assert.match(sent[0].html, /ST-1/);
  assert.doesNotMatch(sent[0].html, />ST-2</);
  assert.match(sent[0].text, /2 orders were created yesterday/);
});

test('attachment-cleanup removes expired files but keeps audit documents', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-uploads-'));
  const old = new Date('2025-01-01T00:00:00Z');
  const files = ['ST-1/photo.jpg', 'ST-1/customs_declaration.pdf', 'ST-1/pod-ups.jpg', 'ST-1/label.pdf', 'ST-2/notes/scan.png', 'ST-3/fresh.txt'];
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), 'x');
    if (!f.startsWith('ST-3')) fs.utimesSync(path.join(root, f), old, old);
  }
  const summary = await attachmentCleanup.run({ config: { uploadDir: root, attachmentRetentionDays: 90 }, now: new Date('2026-03-01') });
  assert.deepEqual(summary, { removed: 2, files: ['ST-1/photo.jpg', 'ST-2/notes/scan.png'] });
  assert.ok(fs.existsSync(path.join(root, 'ST-1/customs_declaration.pdf')));
  assert.ok(fs.existsSync(path.join(root, 'ST-3/fresh.txt')));
  assert.ok(!fs.existsSync(path.join(root, 'ST-1/photo.jpg')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('warehouse-report builds the weekly SQL and emails an HTML table', async () => {
  assert.equal(
    warehouseReport.weeklyQuery(new Date('2026-02-25T12:00:00Z')),
    "SELECT warehouse, SUM(picked) AS picked, SUM(shipped) AS shipped, AVG(pick_minutes) AS avgPickMinutes FROM `warehouse_daily` WHERE day >= '2026-02-23' AND day < '2026-03-02' GROUP BY warehouse ORDER BY warehouse"
  );
  sent.length = 0;
  const summary = await warehouseReport.run({
    config: { analyticsUrl: 'mysql://r:p@db/analytics', opsRecipients: ['ops@shiptrack.example.com'] },
    now: new Date('2026-03-02T08:00:00Z'),
    fetch: async () => [{ warehouse: 'LON-01', picked: 120, shipped: 118, avgPickMinutes: 6.25 }],
  });
  assert.deepEqual(summary, { warehouses: 1 });
  assert.match(sent[0].html, /week of 23 Feb 2026/);
  assert.match(sent[0].html, /<td>LON-01<\/td><td>120<\/td><td>118<\/td><td>6\.3 min<\/td>/);
});
