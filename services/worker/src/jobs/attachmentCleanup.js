const fs = require('fs');
const path = require('path');
const glob = require('glob');
const rimraf = require('rimraf');
const minimatch = require('minimatch');
const moment = require('moment');

// Delete order attachments past retention. Customs paperwork and proofs of delivery
// are kept for 7 years for audit, so they're excluded by pattern.
const KEEP = ['**/customs*', '**/pod-*', '**/label.pdf'];

function findExpired(rootDir, retentionDays, now = new Date()) {
  const cutoff = moment(now).subtract(retentionDays, 'days');
  return new Promise((resolve, reject) => {
    glob('*/**/*', { cwd: rootDir, nodir: true }, (err, files) => {
      if (err) return reject(err);
      const expired = files.filter((f) => {
        if (KEEP.some((pattern) => minimatch(f, pattern, { nocase: true, matchBase: true }))) return false;
        return moment(fs.statSync(path.join(rootDir, f)).mtime).isBefore(cutoff);
      });
      return resolve(expired.sort());
    });
  });
}

function remove(rootDir, file) {
  return new Promise((resolve, reject) => {
    rimraf(path.join(rootDir, file), { glob: false }, (err) => (err ? reject(err) : resolve(file)));
  });
}

async function run({ config, now = new Date() }) {
  if (!fs.existsSync(config.uploadDir)) return { removed: 0 };
  const expired = await findExpired(config.uploadDir, config.attachmentRetentionDays, now);
  await Promise.all(expired.map((f) => remove(config.uploadDir, f)));
  return { removed: expired.length, files: expired };
}

module.exports = { name: 'attachment-cleanup', at: '02:30', run, findExpired };
