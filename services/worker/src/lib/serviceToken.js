const jwt = require('jsonwebtoken');
const config = require('../config');

// Short-lived tokens the worker presents to the API and the carrier gateway.
function issue(scope, ttl = '5m') {
  return jwt.sign({ sub: 'svc:worker', scope }, config.serviceSecret, { algorithm: 'HS256', expiresIn: ttl, issuer: 'shiptrack-worker' });
}

function verify(token) {
  return jwt.verify(token, config.serviceSecret, { algorithms: ['HS256'], issuer: 'shiptrack-worker' });
}

module.exports = { issue, verify };
