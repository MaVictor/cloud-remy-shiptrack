const http = require('http');
const config = require('./config');
const { createApp } = require('./app');

const app = createApp();
const server = http.createServer(app);
app.locals.statusFeed.attach(server);
server.listen(config.port, () => console.log(`carrier-gateway listening on :${config.port}`));
