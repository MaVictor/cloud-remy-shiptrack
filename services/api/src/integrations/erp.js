const { Connection, Request, TYPES } = require('tedious');

// Stock levels still live in the legacy ERP (SQL Server). We sync them nightly and
// on demand when an agent opens an order with low-stock items.
function connectionConfig(url) {
  const u = new URL(url);
  return {
    server: u.hostname,
    authentication: {
      type: 'default',
      options: { userName: decodeURIComponent(u.username), password: decodeURIComponent(u.password) },
    },
    options: {
      port: Number(u.port || 1433),
      database: u.pathname.replace(/^\//, '') || 'erp',
      encrypt: true,
      trustServerCertificate: u.searchParams.get('trustServerCertificate') === 'true',
      connectTimeout: 5000,
      requestTimeout: 15000,
    },
  };
}

function stockLevelRequest(skus, onRow, onDone) {
  const placeholders = skus.map((_, i) => `@sku${i}`).join(', ');
  const request = new Request(
    `SELECT sku, warehouse_code, on_hand, reserved FROM dbo.stock_levels WHERE sku IN (${placeholders})`,
    onDone
  );
  skus.forEach((sku, i) => request.addParameter(`sku${i}`, TYPES.NVarChar, sku, { length: 32 }));
  request.on('row', (columns) => {
    const row = {};
    columns.forEach((c) => {
      row[c.metadata.colName] = c.value;
    });
    onRow(row);
  });
  return request;
}

function fetchStockLevels(url, skus) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const connection = new Connection(connectionConfig(url));
    connection.on('connect', (err) => {
      if (err) return reject(err);
      return connection.execSql(
        stockLevelRequest(skus, (row) => rows.push(row), (reqErr) => {
          connection.close();
          if (reqErr) return reject(reqErr);
          return resolve(rows);
        })
      );
    });
    connection.connect();
  });
}

module.exports = { connectionConfig, stockLevelRequest, fetchStockLevels };
