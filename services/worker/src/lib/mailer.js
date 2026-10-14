const nodemailer = require('nodemailer');
const Mailgen = require('mailgen');
const config = require('../config');

const generator = new Mailgen({
  theme: 'salted',
  product: { name: 'ShipTrack Operations', link: 'https://ops.shiptrack.example.com/' },
});

let transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : nodemailer.createTransport({ jsonTransport: true });

async function send({ to, subject, email, html }) {
  return transport.sendMail({
    from: config.mailFrom,
    to,
    subject,
    html: html || generator.generate(email),
    text: email ? generator.generatePlaintext(email) : undefined,
  });
}

function setTransport(t) {
  transport = t;
}

module.exports = { send, setTransport };
