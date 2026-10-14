const jsonwebtoken = require('jsonwebtoken');
const validator = require('validator');
const config = require('../config');

// Seed accounts for local development and tests. Production reads from the identity service.
const seed = [
  { id: 'u-100', email: 'ops@shiptrack.example.com', name: 'Ops Admin', role: 'admin', password: 'correct-horse' },
  { id: 'u-200', email: 'dana@shiptrack.example.com', name: 'Dana Agent', role: 'agent', password: 'battery-staple' },
];

function findById(id) {
  return seed.find((u) => u.id === id) || null;
}

function findByEmail(email) {
  if (!validator.isEmail(String(email || ''))) return null;
  const normalized = validator.normalizeEmail(email);
  return seed.find((u) => validator.normalizeEmail(u.email) === normalized) || null;
}

function authenticate(email, password) {
  const user = findByEmail(email);
  if (!user || user.password !== password) return null;
  return user;
}

function issueToken(user) {
  return jsonwebtoken.sign({ sub: user.id, role: user.role, email: user.email }, config.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: config.jwt.ttl,
  });
}

function decodeToken(token) {
  return jsonwebtoken.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
}

module.exports = { findById, findByEmail, authenticate, issueToken, decodeToken };
