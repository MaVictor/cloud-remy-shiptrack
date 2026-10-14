const { test } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, login } = require('./helpers');
const users = require('../src/services/users');

test('login returns a signed HS256 token', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'dana@shiptrack.example.com', password: 'battery-staple' });
  assert.equal(res.status, 200);
  const claims = users.decodeToken(res.body.token);
  assert.equal(claims.sub, 'u-200');
  assert.equal(claims.role, 'agent');
  assert.ok(claims.exp > claims.iat);
});

test('login rejects bad credentials', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'dana@shiptrack.example.com', password: 'nope' });
  assert.equal(res.status, 401);
});

test('login validates the request body', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'validation_failed');
  assert.ok(res.body.details.some((d) => d.segment === 'body'));
});

test('/me exposes token claims via express-jwt', async () => {
  const token = await login();
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id: 'u-200', role: 'agent', email: 'dana@shiptrack.example.com' });
});

test('/me rejects missing and tampered tokens', async () => {
  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  const token = await login();
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}x`);
  assert.equal(res.status, 401);
});

test('admin routes use passport and enforce role', async () => {
  const agent = await login();
  assert.equal((await request(app).get('/api/admin/whoami').set('Authorization', `Bearer ${agent}`)).status, 403);

  const admin = await login('ops@shiptrack.example.com', 'correct-horse');
  const res = await request(app).get('/api/admin/whoami').set('Authorization', `Bearer ${admin}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Ops Admin');
});
