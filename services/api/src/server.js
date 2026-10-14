const http = require('http');
const mongoose = require('mongoose');
const config = require('./config');
const app = require('./app');
const tracking = require('./services/tracking');

const server = http.createServer(app);
tracking.attach(server);

async function start() {
  try {
    await mongoose.connect(config.mongoUrl, { serverSelectionTimeoutMS: 2000 });
    console.log('connected to mongo');
  } catch (err) {
    console.warn(`mongo unavailable (${err.message}); using in-memory order store`);
  }
  server.listen(config.port, () => console.log(`shiptrack-api listening on :${config.port}`));
}

start();
