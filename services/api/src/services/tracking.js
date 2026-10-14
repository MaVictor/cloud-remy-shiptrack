const { WebSocketServer, WebSocket } = require('ws');

// Pushes order status changes to dashboards subscribed on /ws/tracking.
let wss = null;

function attach(server) {
  wss = new WebSocketServer({ server, path: '/ws/tracking' });
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'hello', at: new Date().toISOString() }));
  });
  return wss;
}

function broadcast(event) {
  if (!wss) return 0;
  const payload = JSON.stringify(event);
  let sent = 0;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      sent += 1;
    }
  }
  return sent;
}

function close() {
  return new Promise((resolve) => {
    if (!wss) return resolve();
    for (const client of wss.clients) client.terminate();
    wss.close(() => resolve());
    wss = null;
  });
}

module.exports = { attach, broadcast, close };
