const nodemailer = require('nodemailer');
const Mailgen = require('mailgen');
const moment = require('moment');
const config = require('../config');

const mailGenerator = new Mailgen({
  theme: 'default',
  product: { name: 'ShipTrack', link: 'https://shiptrack.example.com/' },
});

// With no SMTP_URL configured (dev and test) messages are rendered to JSON instead of sent.
function createTransport() {
  if (config.mail.smtpUrl) return nodemailer.createTransport(config.mail.smtpUrl);
  return nodemailer.createTransport({ jsonTransport: true });
}

let transport = createTransport();

function buildShippedEmail(order) {
  const eta = moment(order.updatedAt || undefined).add(3, 'days').format('dddd, MMMM Do');
  return {
    body: {
      name: order.customerEmail,
      intro: `Good news: order ${order.reference} is on its way.`,
      table: {
        data: order.items.map((i) => ({ item: i.sku, quantity: i.quantity })),
      },
      action: {
        instructions: `Estimated delivery: ${eta}. Track it any time:`,
        button: {
          color: '#4b45a1',
          text: 'Track my order',
          link: `https://shiptrack.example.com/track/${order.trackingNumber || order.reference}`,
        },
      },
      outro: 'Questions? Just reply to this email.',
    },
  };
}

async function sendShippedNotification(order) {
  const email = buildShippedEmail(order);
  const info = await transport.sendMail({
    from: config.mail.from,
    to: order.customerEmail,
    subject: `Your ShipTrack order ${order.reference} has shipped`,
    html: mailGenerator.generate(email),
    text: mailGenerator.generatePlaintext(email),
  });
  return info;
}

async function sendPasswordReset(email, token) {
  const content = {
    body: {
      intro: 'Someone asked to reset the password for your ShipTrack portal account.',
      action: {
        instructions: 'This link works once and expires in 30 minutes:',
        button: { color: '#4b45a1', text: 'Reset password', link: `https://portal.shiptrack.example.com/reset#token=${encodeURIComponent(token)}` },
      },
      outro: "If this wasn't you, you can ignore this email.",
    },
  };
  return transport.sendMail({
    from: config.mail.from,
    to: email,
    subject: 'Reset your ShipTrack password',
    html: mailGenerator.generate(content),
    text: mailGenerator.generatePlaintext(content),
  });
}

function setTransport(t) {
  transport = t;
}

module.exports = { sendShippedNotification, buildShippedEmail, sendPasswordReset, setTransport };
