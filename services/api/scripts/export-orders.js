#!/usr/bin/env node
// Nightly export for finance: node scripts/export-orders.js --out exports --keep 14 [--status delivered]
const minimist = require('minimist');
const orders = require('../src/services/orders');
const { writeExport, pruneExports } = require('../src/services/exporter');

async function main(argv) {
  const args = minimist(argv, {
    string: ['out', 'status'],
    default: { out: 'exports', keep: 30 },
    alias: { o: 'out', k: 'keep', s: 'status' },
  });
  const file = writeExport(args.out, orders.list({ status: args.status, limit: 10000 }));
  const pruned = await pruneExports(args.out, Number(args.keep));
  return { file, pruned };
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(({ file, pruned }) => console.log(`wrote ${file}; pruned ${pruned.length} old export(s)`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { main };
