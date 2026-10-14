const express = require('express');
const morgan = require('morgan');
const _ = require('lodash');

// Liveness/readiness for the orchestrator plus a view of recent job runs.
function createHealthApp(history) {
  const app = express();
  app.use(morgan('tiny', { skip: () => process.env.NODE_ENV === 'test' }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/runs', (req, res) => {
    const latest = _.map(_.groupBy(history, 'job'), (runs) => _.maxBy(runs, 'startedAt'));
    res.json({ runs: _.sortBy(latest, 'job') });
  });
  return app;
}

module.exports = { createHealthApp };
