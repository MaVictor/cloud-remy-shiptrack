const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');

function client(baseURL = config.carrier.url) {
  return axios.create({
    baseURL,
    timeout: 5000,
    headers: { 'X-Api-Key': config.carrier.apiKey, 'User-Agent': 'shiptrack-api/1.4' },
  });
}

// Request a shipping label. The carrier API takes multipart so we can attach a customs PDF.
async function createLabel(order, { baseURL, customsDoc } = {}) {
  const form = new FormData();
  form.append('reference', order.reference);
  form.append('country', order.destination.country);
  form.append('postcode', order.destination.postcode);
  form.append('parcels', JSON.stringify(order.items.map((i) => ({ sku: i.sku, qty: i.quantity }))));
  if (customsDoc) {
    form.append('customs', customsDoc, { filename: 'customs.pdf', contentType: 'application/pdf' });
  }

  const res = await client(baseURL).post('/v2/labels', form, { headers: form.getHeaders() });
  return { trackingNumber: res.data.trackingNumber, labelUrl: res.data.labelUrl };
}

async function getTrackingEvents(trackingNumber, { baseURL } = {}) {
  const res = await client(baseURL).get(`/v2/tracking/${encodeURIComponent(trackingNumber)}`);
  return res.data.events || [];
}

module.exports = { createLabel, getTrackingEvents };
