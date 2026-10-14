const mysql = require('mysql2');
const { v4: uuidv4 } = require('uuid');

// Merchants save order searches ("delivered to DE last 30 days, newest first") and run them
// against the analytics replica. Filters map to fixed columns; values are bound, never spliced.
const FILTERS = {
  status: { column: 'status', op: '=' },
  country: { column: 'destination_country', op: '=' },
  minTotal: { column: 'total', op: '>=' },
  maxTotal: { column: 'total', op: '<=' },
  createdAfter: { column: 'created_at', op: '>=' },
  createdBefore: { column: 'created_at', op: '<' },
  carrier: { column: 'carrier', op: '=' },
};
const SORTS = { newest: 'created_at DESC', oldest: 'created_at ASC', total: 'total DESC', status: 'status ASC, created_at DESC' };
const searches = new Map();

function buildQuery(accountId, { filters = {}, sort = 'newest', limit = 50 } = {}) {
  const clauses = ['account_id = ?'];
  const params = [accountId];
  for (const [name, value] of Object.entries(filters)) {
    const f = FILTERS[name];
    if (!f) throw Object.assign(new Error(`unknown filter ${name}`), { status: 422 });
    clauses.push(`${f.column} ${f.op} ?`);
    params.push(value);
  }
  const orderBy = SORTS[sort];
  if (!orderBy) throw Object.assign(new Error(`unknown sort ${sort}`), { status: 422 });
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  return mysql.format(`SELECT reference, status, destination_country, total, created_at FROM orders WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy} LIMIT ${n}`, params);
}

function save(accountId, name, definition) {
  buildQuery(accountId, definition);
  const s = { id: uuidv4(), accountId, name: String(name).slice(0, 80), definition };
  searches.set(s.id, s);
  return s;
}

function get(accountId, id) {
  const s = searches.get(id);
  return s && s.accountId === accountId ? s : null;
}

function clear() {
  searches.clear();
}

module.exports = { buildQuery, save, get, clear, FILTERS, SORTS };
