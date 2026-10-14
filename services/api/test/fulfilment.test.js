const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { request, app, login, sampleOrder } = require('./helpers');
const config = require('../src/config');
const orders = require('../src/services/orders');
const routing = require('../src/services/routing');
const customs = require('../src/services/customs');
const customsKeys = require('../src/services/customsKeys');
const erp = require('../src/integrations/erp');
const { writeExport, pruneExports } = require('../src/services/exporter');
const exportCli = require('../scripts/export-orders');

beforeEach(() => orders.clear());
after(() => fs.rmSync(config.uploadDir, { recursive: true, force: true }));

async function createOrder(body = sampleOrder) {
  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };
  const res = await request(app).post('/api/orders').set(auth).send(body);
  return { auth, order: res.body };
}

test('routes SKUs to warehouses by glob rule and destination', () => {
  assert.equal(routing.routeItem('HAZ-LITHIUM-01', 'GB'), 'RTM-HAZMAT');
  assert.equal(routing.routeItem('box-small', 'IE'), 'LON-01');
  assert.equal(routing.routeItem('BOX-SMALL', 'FR'), 'BER-01');
  assert.equal(routing.routeItem('COLD-PACK', 'FR'), 'AMS-COLD');
  assert.equal(routing.routeItem('MUG-WHITE', 'GB'), 'BER-01');
});

test('plan endpoint groups line items by warehouse', async () => {
  const { auth, order } = await createOrder({
    ...sampleOrder,
    items: [...sampleOrder.items, { sku: 'HAZ-AEROSOL', quantity: 1, unitPrice: 9 }],
  });
  const res = await request(app).get(`/api/orders/${order.reference}/plan`).set(auth);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.plan, { 'LON-01': ['BOX-SMALL', 'TAPE-50M'], 'RTM-HAZMAT': ['HAZ-AEROSOL'] });
});

test('customs declarations are signed and verifiable', async () => {
  const { auth, order } = await createOrder({ ...sampleOrder, destination: { country: 'US', postcode: '10001' } });
  const res = await request(app).post(`/api/orders/${order.reference}/customs`).set(auth);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/xml/);
  assert.match(res.text, /<Destination>US<\/Destination>/);
  assert.match(res.text, /<SignatureValue>/);
  assert.equal(customs.verify(res.text, customsKeys.publicKey()), true);

  const tampered = res.text.replace('<Quantity>2</Quantity>', '<Quantity>200</Quantity>');
  assert.equal(customs.verify(tampered, customsKeys.publicKey()), false);
});

test('carrier JSON webhooks update order status via jsonpath', async () => {
  const { order } = await createOrder();
  const dhl = { shipments: [{ events: [{ statusCode: 'DELIVERED', shipmentReference: order.reference }] }] };
  const res = await request(app).post('/webhooks/carriers/dhl').send(dhl);
  assert.deepEqual(res.body, { received: 1, applied: 1 });
  assert.equal(orders.get(order.reference).status, 'delivered');

  const generic = { data: { tracking: { events: [{ code: 'I', reference: order.reference }] } } };
  const res2 = await request(app).post('/webhooks/carriers/acme').send(generic);
  assert.deepEqual(res2.body, { received: 1, applied: 1 });
  assert.equal(orders.get(order.reference).status, 'in_transit');
});

test('proof-of-delivery photos are parsed with formidable', async () => {
  const { order } = await createOrder();
  const res = await request(app)
    .post('/webhooks/carriers/ups/pod')
    .field('reference', order.reference)
    .attach('photo', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'pod.jpg');
  assert.equal(res.status, 201);
  assert.equal(res.body.stored, 'pod-ups.jpg');
  assert.equal(res.body.bytes, 7);
  assert.equal(orders.get(order.reference).status, 'delivered');

  const missing = await request(app).post('/webhooks/carriers/ups/pod').field('reference', order.reference);
  assert.equal(missing.status, 400);
});

test('label PDFs are streamed with caching headers', async () => {
  const { auth, order } = await createOrder();
  assert.equal((await request(app).get(`/api/orders/${order.reference}/label`).set(auth)).status, 404);

  const dir = path.join(config.uploadDir, order.reference);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'label.pdf'), '%PDF-1.4 label');
  const res = await request(app).get(`/api/orders/${order.reference}/label`).set(auth);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['cache-control'], /max-age=3600/);
  assert.match(res.headers['content-disposition'], new RegExp(`${order.reference}-label.pdf`));
  assert.ok(res.headers.etag);
});

test('outdated mobile clients are told to upgrade', async () => {
  const old = await request(app).get('/healthz').set('X-Client-Version', 'driver-app/3.1.9');
  assert.equal(old.status, 426);
  assert.equal(old.body.minimum, '3.2.0');
  assert.equal((await request(app).get('/healthz').set('X-Client-Version', 'driver-app/v3.4')).status, 200);
  assert.equal((await request(app).get('/healthz').set('X-Client-Version', 'warehouse-app/2.8.0-beta.2')).status, 200);
  assert.equal((await request(app).get('/healthz').set('X-Client-Version', 'web/1.0.0')).status, 200);
});

test('ERP connection config and parameterised stock query', () => {
  const cfg = erp.connectionConfig('mssql://svc%40erp:p%40ss@erp.internal:1444/stock?trustServerCertificate=true');
  assert.equal(cfg.server, 'erp.internal');
  assert.equal(cfg.authentication.options.userName, 'svc@erp');
  assert.equal(cfg.authentication.options.password, 'p@ss');
  assert.equal(cfg.options.port, 1444);
  assert.equal(cfg.options.database, 'stock');
  assert.equal(cfg.options.trustServerCertificate, true);

  const req = erp.stockLevelRequest(['BOX-SMALL', 'TAPE-50M'], () => {}, () => {});
  assert.match(req.sqlTextOrProcedure, /WHERE sku IN \(@sku0, @sku1\)/);
  assert.deepEqual(req.parameters.map((p) => [p.name, p.value]), [['sku0', 'BOX-SMALL'], ['sku1', 'TAPE-50M']]);
});

test('stock endpoint reports when the ERP is not configured', async () => {
  const admin = await login('ops@shiptrack.example.com', 'correct-horse');
  const res = await request(app).get('/api/admin/stock?skus=BOX-SMALL').set('Authorization', `Bearer ${admin}`);
  assert.equal(res.status, 503);
});

test('exports orders to dated CSV folders and prunes old ones', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiptrack-export-'));
  fs.mkdirSync(path.join(root, '2026-01-01', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, '2026-01-01', 'nested', 'old.csv'), 'x');
  fs.mkdirSync(path.join(root, 'keep-me'));

  const file = writeExport(
    root,
    [{ reference: 'ST-1', status: 'delivered', customerEmail: 'a@b.co', destination: { country: 'GB' }, total: 12, createdAt: '2026-03-01' }],
    new Date('2026-03-02T10:11:12Z')
  );
  assert.match(fs.readFileSync(file, 'utf8'), /^reference,status,customer,country,total,created\nST-1,delivered,a@b\.co,GB,12\.00,2026-03-01\n/);

  const pruned = await pruneExports(root, 30, new Date('2026-03-02T10:11:12Z'));
  assert.deepEqual(pruned, ['2026-01-01']);
  assert.deepEqual(fs.readdirSync(root).sort(), ['2026-03-02', 'keep-me']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('export CLI parses arguments', async () => {
  await createOrder();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiptrack-cli-'));
  const { file, pruned } = await exportCli.main(['-o', root, '--keep', '7']);
  assert.ok(file.startsWith(root));
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 2);
  assert.deepEqual(pruned, []);
  fs.rmSync(root, { recursive: true, force: true });
});
