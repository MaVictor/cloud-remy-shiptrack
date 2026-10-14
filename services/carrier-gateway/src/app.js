const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const compression = require('compression');
const morgan = require('morgan');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { isCelebrateError } = require('celebrate');
const config = require('./config');
const pkg = require('../package.json');
const { passport } = require('./lib/auth');
const { createRegistry } = require('./carriers');
const { memoryCache } = require('./lib/rateCache');
const { createStatusFeed } = require('./lib/statusFeed');

function createApp({ registry = createRegistry(config.carriers), cache = memoryCache(), statusFeed = createStatusFeed() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(compression());
  app.use(morgan('short', { skip: () => config.env === 'test' }));
  app.use(bodyParser.json({ limit: '256kb' }));
  app.use(passport.initialize());

  const spec = swaggerJsdoc({
    definition: { openapi: '3.0.3', info: { title: 'ShipTrack Carrier Gateway', version: pkg.version } },
    apis: [path.join(__dirname, 'routes', '*.js')],
  });
  app.get('/openapi.json', (req, res) => res.json(spec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/v1', require('./routes/v1')({ registry, cache, statusFeed }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (isCelebrateError(err)) return res.status(400).json({ error: 'validation_failed', segments: Array.from(err.details.keys()) });
    const status = err.status || (err.response ? 502 : 500);
    return res.status(status).json({ error: err.message });
  });

  app.locals.statusFeed = statusFeed;
  return app;
}

module.exports = { createApp };
