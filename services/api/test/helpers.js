process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), `shiptrack-test-${process.pid}`);

const request = require('supertest');
const app = require('../src/app');

async function login(email = 'dana@shiptrack.example.com', password = 'battery-staple') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.token;
}

const sampleOrder = {
  customerEmail: 'Jamie@Example.com',
  destination: { country: 'GB', postcode: 'EC1A 1BB' },
  items: [
    { sku: 'BOX-SMALL', quantity: 2, unitPrice: 4.5 },
    { sku: 'TAPE-50M', quantity: 1, unitPrice: 3 },
  ],
};

module.exports = { request, app, login, sampleOrder };
