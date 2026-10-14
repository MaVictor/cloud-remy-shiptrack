const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Customers subscribe an endpoint to order events. Because we make requests to URLs
// they give us, destinations must be public HTTPS hosts and we re-check DNS at send time.
const subscriptions = new Map();
const EVENTS = ['order.created', 'order.shipped', 'order.delivered'];

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublicHttps(rawUrl, lookup = dns.lookup) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    throw Object.assign(new Error('invalid url'), { status: 422 });
  }
  if (url.protocol !== 'https:') throw Object.assign(new Error('webhook url must use https'), { status: 422 });
  if (url.username || url.password) throw Object.assign(new Error('credentials in url are not allowed'), { status: 422 });
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw Object.assign(new Error('webhook host must resolve to a public address'), { status: 422 });
  }
  return url;
}

async function subscribe(accountId, { url, events }, { lookup } = {}) {
  const chosen = (events || EVENTS).filter((e) => EVENTS.includes(e));
  if (!chosen.length) throw Object.assign(new Error('no valid events'), { status: 422 });
  await assertPublicHttps(url, lookup);
  const sub = { id: `wh_${uuidv4()}`, accountId, url, events: chosen, secret: crypto.randomBytes(32).toString('hex') };
  subscriptions.set(sub.id, sub);
  return sub;
}

function sign(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function deliver(event, payload, { lookup, http = axios, now = Date.now() } = {}) {
  const results = [];
  for (const sub of subscriptions.values()) {
    if (!sub.events.includes(event)) continue;
    const body = JSON.stringify({ id: uuidv4(), type: event, data: payload });
    const ts = Math.floor(now / 1000);
    try {
      await assertPublicHttps(sub.url, lookup);
      const res = await http.post(sub.url, body, {
        timeout: 5000,
        maxRedirects: 0,
        maxContentLength: 64 * 1024,
        headers: { 'Content-Type': 'application/json', 'ShipTrack-Timestamp': String(ts), 'ShipTrack-Signature': `v1=${sign(sub.secret, ts, body)}` },
      });
      results.push({ id: sub.id, status: res.status });
    } catch (err) {
      results.push({ id: sub.id, error: err.message });
    }
  }
  return results;
}

function list(accountId) {
  return Array.from(subscriptions.values())
    .filter((s) => s.accountId === accountId)
    .map(({ secret, ...rest }) => rest);
}

function clear() {
  subscriptions.clear();
}

module.exports = { subscribe, deliver, list, sign, isPrivateAddress, assertPublicHttps, clear };
