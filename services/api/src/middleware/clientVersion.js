const semver = require('semver');

// The driver and warehouse mobile apps send X-Client-Version. Builds older than the
// minimum get a 426 so they show the "please update" screen instead of failing oddly.
const MINIMUM = { 'driver-app': '3.2.0', 'warehouse-app': '2.8.0' };

module.exports = function clientVersion(req, res, next) {
  const header = req.get('x-client-version');
  if (!header) return next();
  const [app, raw] = header.split('/');
  const min = MINIMUM[app];
  const version = semver.valid(semver.coerce(raw));
  if (!min || !version) return next();
  if (semver.lt(version, min)) {
    return res.status(426).json({ error: 'client_upgrade_required', minimum: min, current: version });
  }
  req.client = { app, version, beta: semver.prerelease(raw) !== null };
  return next();
};
