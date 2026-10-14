const { Connection, Request, TYPES } = require('tedious');
const _ = require('lodash');
const { Stock } = require('../lib/models');

// Pulls stock deltas from the ERP (SQL Server) since the last sync and upserts them.
function connectionConfig(url) {
  const u = new URL(url);
  return {
    server: u.hostname,
    authentication: { type: 'default', options: { userName: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } },
    options: { port: Number(u.port || 1433), database: u.pathname.slice(1) || 'erp', encrypt: true, rowCollectionOnRequestCompletion: true },
  };
}

function deltaRequest(since, cb) {
  const req = new Request(
    'SELECT sku, warehouse_code, on_hand, reserved FROM dbo.stock_levels WHERE modified_at > @since ORDER BY modified_at',
    cb
  );
  req.addParameter('since', TYPES.DateTime2, since);
  return req;
}

function toBulkOps(rows, syncedAt) {
  const valid = rows
    .filter((r) => r.sku && r.warehouse_code && Number.isFinite(r.on_hand))
    .map((r) => ({ ...r, sku: r.sku.trim().toUpperCase() }));
  // Rows arrive oldest first; keep the newest per SKU and warehouse.
  return _.uniqBy(valid.slice().reverse(), (r) => `${r.sku}|${r.warehouse_code}`).map((r) => {
    const doc = new Stock({ sku: r.sku, warehouse: r.warehouse_code, onHand: r.on_hand, reserved: r.reserved || 0, syncedAt });
    const err = doc.validateSync();
    if (err) throw new Error(`invalid stock row ${r.sku}: ${err.message}`);
    return {
      updateOne: {
        filter: { sku: doc.sku, warehouse: doc.warehouse },
        update: { $set: { onHand: doc.onHand, reserved: doc.reserved, syncedAt } },
        upsert: true,
      },
    };
  });
}

function fetchDeltas(url, since) {
  return new Promise((resolve, reject) => {
    const conn = new Connection(connectionConfig(url));
    conn.on('connect', (err) => {
      if (err) return reject(err);
      return conn.execSql(
        deltaRequest(since, (reqErr, count, rows) => {
          conn.close();
          if (reqErr) return reject(reqErr);
          return resolve(rows.map((cols) => Object.fromEntries(cols.map((c) => [c.metadata.colName, c.value]))));
        })
      );
    });
    conn.connect();
  });
}

async function run({ config, since, fetch = fetchDeltas, write = (ops) => Stock.bulkWrite(ops) }) {
  if (!config.erpUrl) return { skipped: 'ERP_URL not set' };
  const now = new Date();
  const rows = await fetch(config.erpUrl, since);
  const ops = toBulkOps(rows, now);
  if (ops.length) await write(ops);
  return { rows: rows.length, upserts: ops.length };
}

module.exports = { name: 'erp-sync', every: '15m', run, connectionConfig, deltaRequest, toBulkOps };
