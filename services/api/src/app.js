const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const compression = require('compression');
const morgan = require('morgan');
const moment = require('moment');
const _ = require('lodash');
const { isCelebrateError } = require('celebrate');
const config = require('./config');
const pkg = require('../package.json');
const requestId = require('./middleware/requestId');
const clientVersion = require('./middleware/clientVersion');
const { passport } = require('./middleware/auth');
const orders = require('./services/orders');

const startedAt = moment();
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(requestId);
app.use(clientVersion);
app.use(compression());
morgan.token('id', (req) => req.id);
app.use(morgan(':id :method :url :status :response-time ms', { skip: () => config.env === 'test' }));
app.use('/webhooks', require('./routes/webhooks'));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(passport.initialize());

app.get('/healthz', (req, res) => res.json({ ok: true, version: pkg.version }));

app.get('/status', (req, res) => {
  res.render('status', {
    version: pkg.version,
    env: config.env,
    startedAt: startedAt.format('YYYY-MM-DD HH:mm:ss'),
    uptime: startedAt.fromNow(true),
    byStatus: _.countBy(orders.list({ limit: 200 }), 'status'),
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/portal', require('./routes/portal'));
app.use('/docs', require('./routes/docs'));

// The React UI (services/web) is built into services/web/dist and served from here in
// production. Unknown GET routes fall through to index.html so client-side routing works.
const webDist = process.env.WEB_DIST || path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|webhooks\/|docs|healthz|status).*/, (req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (isCelebrateError(err)) {
    const details = [];
    for (const [segment, joiError] of err.details.entries()) {
      details.push(...joiError.details.map((d) => ({ segment, message: d.message })));
    }
    return res.status(400).json({ error: 'validation_failed', details });
  }
  if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ error: 'payload_too_large' });
  }
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const status = err.status || 500;
  if (status >= 500 && config.env !== 'test') console.error(req.id, err);
  return res.status(status).json({ error: status >= 500 ? 'internal_error' : err.message, fields: err.fields });
});

module.exports = app;
