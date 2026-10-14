const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');

// Live feed of label/circuit events for the ops dashboard.
function createStatusFeed() {
  let wss = null;
  return {
    attach(server) {
      wss = new WebSocketServer({ server, path: '/v1/feed' });
      return wss;
    },
    publish(event) {
      if (!wss) return 0;
      const message = JSON.stringify({ id: uuidv4(), at: new Date().toISOString(), ...event });
      let n = 0;
      wss.clients.forEach((c) => {
        if (c.readyState === WebSocket.OPEN) {
          c.send(message);
          n += 1;
        }
      });
      return n;
    },
    close() {
      return new Promise((resolve) => (wss ? wss.close(() => resolve()) : resolve()));
    },
  };
}

module.exports = { createStatusFeed };
