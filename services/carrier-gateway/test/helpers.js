process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const config = require('../src/config');

function token(scope, sub = 'svc:worker') {
  return `Bearer ${jwt.sign({ sub, scope }, config.serviceSecret, { algorithm: 'HS256', expiresIn: '5m' })}`;
}

module.exports = { token };
