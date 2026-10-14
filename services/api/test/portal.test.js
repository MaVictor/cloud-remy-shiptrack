const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { request, app } = require('./helpers');
const accounts = require('../src/services/accounts');
const outbound = require('../src/services/outboundWebhooks');
const orders = require('../src/services/orders');
const notes = require('../src/services/notes');
const savedSearches = require('../src/services/savedSearches');
const notifier = require('../src/services/notifier');
const { parseCsv } = require('../src/services/csvImport');
const safeRedirect = require('../src/lib/safeRedirect');

const sent = [];
const transport = nodemailer.createTransport({ jsonTransport: true });
const sendMail = transport.sendMail.bind(transport);
transport.sendMail = async (m) => {
  const info = await sendMail(m);
  sent.push(JSON.parse(info.message));
  return info;
};

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const privateLookup = async () => [{ address: '10.0.0.5', family: 4 }];

beforeEach(() => {
  accounts.clear();
  outbound.clear();
  orders.clear();
  notes.clear();
  savedSearches.clear();
  sent.length = 0;
  notifier.setTransport(transport);
  app.locals.dnsLookup = publicLookup;
});

async function signup(email = 'merchant@example.com') {
  const res = await request(app).post('/api/portal/register').send({ email, password: 'a-long-passphrase' });
  return { token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` }, account: res.body.account };
}

test('register, login and duplicate detection', async () => {
  const { account } = await signup();
  assert.match(account.id, /^c-/);
  assert.equal(account.passwordHash, undefined);
  assert.equal((await request(app).post('/api/portal/register').send({ email: 'Merchant@example.com', password: 'a-long-passphrase' })).status, 409);
  assert.equal((await request(app).post('/api/portal/register').send({ email: 'x@example.com', password: 'short' })).status, 400);

  const ok = await request(app).post('/api/portal/login').send({ email: 'merchant@example.com', password: 'a-long-passphrase' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.redirectTo, '/portal');
  assert.equal((await request(app).post('/api/portal/login').send({ email: 'merchant@example.com', password: 'wrong-passphrase' })).status, 401);
  assert.equal((await request(app).post('/api/portal/login').send({ email: 'nobody@example.com', password: 'a-long-passphrase' })).status, 401);
});

test('login only redirects within the app', async () => {
  await signup();
  const body = { email: 'merchant@example.com', password: 'a-long-passphrase' };
  assert.equal((await request(app).post('/api/portal/login?next=/portal/orders?page=2').send(body)).body.redirectTo, '/portal/orders?page=2');
  assert.equal((await request(app).post('/api/portal/login?next=https://evil.example').send(body)).body.redirectTo, '/portal');
  assert.equal(safeRedirect('//evil.example/x'), '/portal');
  assert.equal(safeRedirect('/\\evil.example'), '/portal');
  assert.equal(safeRedirect('/ok#frag'), '/ok#frag');
});

test('staff tokens are not accepted by the portal', async () => {
  const staff = await request(app).post('/api/auth/login').send({ email: 'dana@shiptrack.example.com', password: 'battery-staple' });
  const res = await request(app).get('/api/portal/webhooks').set('Authorization', `Bearer ${staff.body.token}`);
  assert.equal(res.status, 401);
});

test('profile updates only touch allowed fields', async () => {
  const { auth } = await signup();
  const res = await request(app).patch('/api/portal/profile').set(auth).send({ name: 'Acme Ltd', defaultCountry: 'GB' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Acme Ltd');
  assert.equal((await request(app).patch('/api/portal/profile').set(auth).send({ email: 'other@example.com' })).status, 400);
  assert.equal((await request(app).patch('/api/portal/profile').set(auth).send({ defaultCountry: 'ZZ' })).status, 422);
});

test('password reset is single-use, expires and does not reveal accounts', async () => {
  await signup();
  const unknown = await request(app).post('/api/portal/password-reset').send({ email: 'nobody@example.com' });
  assert.equal(unknown.status, 202);
  assert.equal(sent.length, 0);

  const known = await request(app).post('/api/portal/password-reset').send({ email: 'merchant@example.com' });
  assert.equal(known.status, 202);
  assert.equal(sent.length, 1);
  const token = decodeURIComponent(/token=([^"&\s]+)/.exec(sent[0].html)[1]);

  assert.equal((await request(app).post('/api/portal/password-reset/confirm').send({ token, password: 'another-long-passphrase' })).status, 204);
  assert.equal((await request(app).post('/api/portal/password-reset/confirm').send({ token, password: 'another-long-passphrase' })).status, 400);
  assert.equal((await request(app).post('/api/portal/login').send({ email: 'merchant@example.com', password: 'another-long-passphrase' })).status, 200);

  const { token: expired } = accounts.requestPasswordReset('merchant@example.com', Date.now() - 31 * 60 * 1000);
  assert.equal(await accounts.resetPassword(expired, 'yet-another-passphrase'), false);
});

test('api keys authenticate, are shown once and can be revoked', async () => {
  const { auth } = await signup();
  const created = await request(app).post('/api/portal/api-keys').set(auth).send({ label: 'ERP integration' });
  assert.equal(created.status, 201);
  assert.match(created.body.key, /^stk_[0-9a-f]{8}_[A-Za-z0-9_-]{32}$/);
  const keyAuth = { Authorization: `ApiKey ${created.body.key}` };
  assert.equal((await request(app).get('/api/portal/webhooks').set(keyAuth)).status, 200);
  assert.equal((await request(app).get('/api/portal/webhooks').set({ Authorization: `ApiKey ${created.body.key.slice(0, -1)}x` })).status, 401);
  assert.equal((await request(app).delete(`/api/portal/api-keys/${created.body.prefix}`).set(auth)).status, 204);
  assert.equal((await request(app).get('/api/portal/webhooks').set(keyAuth)).status, 401);
});

test('webhook subscriptions must point at public https hosts', async () => {
  const { auth } = await signup();
  const ok = await request(app).post('/api/portal/webhooks').set(auth).send({ url: 'https://hooks.example.com/shiptrack', events: ['order.shipped'] });
  assert.equal(ok.status, 201);
  assert.match(ok.body.secret, /^[0-9a-f]{64}$/);
  assert.equal((await request(app).get('/api/portal/webhooks').set(auth)).body.data[0].secret, undefined);

  assert.equal((await request(app).post('/api/portal/webhooks').set(auth).send({ url: 'http://hooks.example.com/x' })).status, 400);
  app.locals.dnsLookup = privateLookup;
  assert.equal((await request(app).post('/api/portal/webhooks').set(auth).send({ url: 'https://internal.example.com/x' })).status, 422);
});

test('private address detection', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(outbound.isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '172.32.0.1', '2606:4700::1111']) assert.equal(outbound.isPrivateAddress(ip), false, ip);
});

test('webhook deliveries are signed and re-check DNS at send time', async () => {
  const sub = await outbound.subscribe('c-1', { url: 'https://hooks.example.com/a', events: ['order.shipped'] }, { lookup: publicLookup });
  const posts = [];
  const http = {
    post: async (url, body, opts) => {
      posts.push({ url, body, headers: opts.headers, maxRedirects: opts.maxRedirects });
      return { status: 200 };
    },
  };
  const results = await outbound.deliver('order.shipped', { reference: 'ST-1' }, { lookup: publicLookup, http, now: 1772000000000 });
  assert.deepEqual(results, [{ id: sub.id, status: 200 }]);
  assert.equal(posts[0].maxRedirects, 0);
  assert.equal(posts[0].headers['ShipTrack-Signature'], `v1=${outbound.sign(sub.secret, 1772000000, posts[0].body)}`);

  const rebound = await outbound.deliver('order.shipped', {}, { lookup: privateLookup, http });
  assert.match(rebound[0].error, /public address/);
  assert.equal(posts.length, 1);
});

test('csv import groups line items into orders and reports bad rows', async () => {
  const { auth } = await signup();
  const csv = [
    'customer_email,country,postcode,sku,quantity,unit_price',
    'jo@example.com,gb,EC1A 1BB,box-small,2,4.50',
    'jo@example.com,GB,EC1A 1BB,"TAPE-50M",1,3',
    'sam@example.com,DE,10115,BOX-LARGE,0,9',
    'kim@example.com,ZZ,1,BOX-LARGE,1,9',
  ].join('\r\n');
  const res = await request(app).post('/api/portal/imports').set(auth).set('Content-Type', 'text/csv').send(csv);
  assert.equal(res.status, 201);
  assert.equal(res.body.created.length, 1);
  assert.equal(orders.get(res.body.created[0]).items.length, 2);
  assert.deepEqual(res.body.errors.map((e) => e.line || e.lines), [4, [5]]);

  assert.equal((await request(app).post('/api/portal/imports').set(auth).set('Content-Type', 'text/csv').send('a,b\n1,2')).status, 422);
  assert.deepEqual(parseCsv('a,"b ""quoted"", c"\n'), [['a', 'b "quoted", c']]);
});

test('notes are stored as text and rendered escaped', async () => {
  const { auth } = await signup();
  const order = orders.create({ customerEmail: 'jo@example.com', destination: { country: 'GB', postcode: 'EC1A 1BB' }, items: [{ sku: 'BOX-SMALL', quantity: 1, unitPrice: 1 }] });
  const text = 'Leave with neighbour <b>at no. 4</b> & ring twice';
  assert.equal((await request(app).post(`/api/portal/orders/${order.reference}/notes`).set(auth).send({ text })).status, 201);
  const json = await request(app).get(`/api/portal/orders/${order.reference}/notes`).set(auth);
  assert.equal(json.body.data[0].body, text);
  const html = await request(app).get(`/api/portal/orders/${order.reference}/notes`).set(auth).set('Accept', 'text/html');
  assert.match(html.text, /Leave with neighbour &lt;b&gt;at no\. 4&lt;\/b&gt; &amp; ring twice/);
  assert.equal((await request(app).post('/api/portal/orders/ST-NOPE0000/notes').set(auth).send({ text })).status, 404);
});

test('saved searches bind values and only allow known filters and sorts', async () => {
  const { auth, account } = await signup();
  const created = await request(app)
    .post('/api/portal/searches')
    .set(auth)
    .send({ name: 'DE delivered', definition: { filters: { country: "DE' OR '1'='1", status: 'delivered' }, sort: 'total', limit: 20 } });
  assert.equal(created.status, 201);
  const { body } = await request(app).get(`/api/portal/searches/${created.body.id}/sql`).set(auth);
  assert.equal(
    body.sql,
    `SELECT reference, status, destination_country, total, created_at FROM orders WHERE account_id = '${account.id}' AND destination_country = 'DE\\' OR \\'1\\'=\\'1' AND status = 'delivered' ORDER BY total DESC LIMIT 20`
  );
  assert.equal((await request(app).post('/api/portal/searches').set(auth).send({ name: 'x', definition: { sort: 'created_at; DROP TABLE orders' } })).status, 400);
  assert.equal((await request(app).post('/api/portal/searches').set(auth).send({ name: 'x', definition: { filters: { 'total) OR (1': 1 } } })).status, 400);

  const other = await signup('other@example.com');
  assert.equal((await request(app).get(`/api/portal/searches/${created.body.id}/sql`).set(other.auth)).status, 404);
});
