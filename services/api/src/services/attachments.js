const path = require('path');
const fs = require('fs');
const glob = require('glob');
const config = require('../config');

function orderDir(reference) {
  return path.resolve(config.uploadDir, reference);
}

function ensureOrderDir(reference) {
  const dir = orderDir(reference);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// List every file attached to an order, including nested customs folders.
function listAttachments(reference) {
  return new Promise((resolve, reject) => {
    glob('**/*', { cwd: orderDir(reference), nodir: true }, (err, files) => {
      if (err) return reject(err);
      return resolve(files.sort());
    });
  });
}

module.exports = { orderDir, ensureOrderDir, listAttachments };
