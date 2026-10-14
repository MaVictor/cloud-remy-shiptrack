const crypto = require('crypto');
const mongoose = require('mongoose');

// Quotes are valid for 15 minutes. Mongo TTL index in production; a Map in dev/test.
const quoteSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    quotes: { type: [mongoose.Schema.Types.Mixed], required: true },
    createdAt: { type: Date, default: Date.now, expires: 900 },
  },
  { versionKey: false }
);
const QuoteCache = mongoose.models.QuoteCache || mongoose.model('QuoteCache', quoteSchema);

function keyFor(shipment) {
  const canonical = JSON.stringify([shipment.from, shipment.to, shipment.weightKg, shipment.shipDate]);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function memoryCache(ttlMs = 15 * 60 * 1000) {
  const entries = new Map();
  return {
    async get(key) {
      const e = entries.get(key);
      if (!e || Date.now() - e.at > ttlMs) return null;
      return e.quotes;
    },
    async set(key, quotes) {
      const doc = new QuoteCache({ key, quotes });
      const err = doc.validateSync();
      if (err) throw err;
      entries.set(key, { quotes, at: Date.now() });
    },
    clear: () => entries.clear(),
  };
}

module.exports = { keyFor, memoryCache, QuoteCache };
