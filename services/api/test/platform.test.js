const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('ws');
const { request, app } = require('./helpers');
const tracking = require('../src/services/tracking');

test('health check and request ids', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);

  const id = '3b241101-e2bb-4255-8caf-4136c566a962';
  const echoed = await request(app).get('/healthz').set('X-Request-Id', id);
  assert.equal(echoed.headers['x-request-id'], id);
  const replaced = await request(app).get('/healthz').set('X-Request-Id', 'not-a-uuid');
  assert.notEqual(replaced.headers['x-request-id'], 'not-a-uuid');
});

test('status page renders with ejs', async () => {
  const res = await request(app).get('/status');
  assert.equal(res.status, 200);
  assert.match(res.text, /<h1>ShipTrack API <small>v1\.4\.0<\/small><\/h1>/);
  assert.match(res.text, /Environment: <strong>test<\/strong>/);
});

test('openapi spec is generated from route annotations', async () => {
  const res = await request(app).get('/docs/openapi.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.info.title, 'ShipTrack API');
  assert.ok(res.body.paths['/api/orders']);
  assert.ok(res.body.paths['/api/auth/login'].post);
});

test('swagger ui is served', async () => {
  const res = await request(app).get('/docs/').redirects(1);
  assert.equal(res.status, 200);
  assert.match(res.text, /swagger-ui/);
});

test('large responses are compressed', async () => {
  const res = await request(app).get('/docs/').redirects(1).set('Accept-Encoding', 'gzip');
  assert.equal(res.headers['content-encoding'], 'gzip');
});

test('tracking events are pushed over websockets', async () => {
  const server = http.createServer(app);
  tracking.attach(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/tracking`);
  const messages = [];
  await new Promise((resolve, reject) => {
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length === 1) tracking.broadcast({ type: 'order.shipped', reference: 'ST-1' });
      if (messages.length === 2) resolve();
    });
    ws.on('error', reject);
  });
  assert.equal(messages[0].type, 'hello');
  assert.deepEqual(messages[1], { type: 'order.shipped', reference: 'ST-1' });
  ws.close();
  await tracking.close();
  await new Promise((resolve) => server.close(resolve));
});
