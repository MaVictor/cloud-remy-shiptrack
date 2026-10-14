const { v4: uuidv4 } = require('uuid');
const _ = require('lodash');
const Order = require('../models/order');

// In-memory store used for development and tests. The Mongo-backed store shares the same
// interface and is selected in server.js when MONGO_URL is reachable.
const store = new Map();

function create(input) {
  const doc = new Order({ ...input, reference: `ST-${uuidv4().slice(0, 8).toUpperCase()}` });
  const err = doc.validateSync();
  if (err) {
    const fields = Object.keys(err.errors);
    const e = new Error(`Order validation failed: ${fields.join(', ')}`);
    e.status = 422;
    e.fields = fields;
    throw e;
  }
  const json = doc.toJSON();
  json.createdAt = new Date().toISOString();
  store.set(json.reference, json);
  return json;
}

function get(reference) {
  return store.get(reference) || null;
}

function list({ status, limit = 50 } = {}) {
  const all = Array.from(store.values());
  const filtered = status ? _.filter(all, { status }) : all;
  return _.take(_.orderBy(filtered, ['createdAt'], ['desc']), limit);
}

function update(reference, patch) {
  const existing = store.get(reference);
  if (!existing) return null;
  const next = _.merge({}, existing, _.pick(patch, ['status', 'trackingNumber']));
  store.set(reference, next);
  return next;
}

function clear() {
  store.clear();
}

module.exports = { create, get, list, update, clear };
