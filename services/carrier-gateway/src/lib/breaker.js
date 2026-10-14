const moment = require('moment');
const nodemailer = require('nodemailer');
const config = require('../config');

// Per-carrier circuit breaker. Opening the circuit pages on-call by email once.
let transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : nodemailer.createTransport({ jsonTransport: true });

class Breaker {
  constructor(name, { threshold = 5, coolDownSeconds = 60 } = {}) {
    this.name = name;
    this.threshold = threshold;
    this.coolDownSeconds = coolDownSeconds;
    this.failures = 0;
    this.openedAt = null;
  }

  get state() {
    if (!this.openedAt) return 'closed';
    return moment().diff(this.openedAt, 'seconds') >= this.coolDownSeconds ? 'half-open' : 'open';
  }

  async call(fn) {
    if (this.state === 'open') {
      const err = new Error(`${this.name} circuit open`);
      err.status = 503;
      throw err;
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (err) {
      this.failures += 1;
      if (this.failures >= this.threshold && this.state === 'closed') {
        this.openedAt = moment();
        await transport.sendMail({
          from: 'gateway@shiptrack.example.com',
          to: config.alertRecipients,
          subject: `[carrier-gateway] ${this.name} circuit opened`,
          text: `${this.failures} consecutive failures. Last error: ${err.message}. Retrying after ${this.coolDownSeconds}s.`,
        });
      }
      throw err;
    }
  }
}

function setTransport(t) {
  transport = t;
}

module.exports = { Breaker, setTransport };
