const axios = require('axios');
const FormData = require('form-data');
const semver = require('semver');
const moment = require('moment');

// DHL's REST API. Label creation moved to multipart in 2.2; older accounts are still on JSON.
module.exports = function dhl({ baseURL, apiKey, apiVersion }) {
  const http = axios.create({ baseURL, timeout: 8000, headers: { 'DHL-API-Key': apiKey, Accept: 'application/json' } });
  const multipartLabels = semver.gte(semver.coerce(apiVersion), '2.2.0');

  return {
    name: 'dhl',
    async quote(shipment) {
      const { data } = await http.post('/rates', {
        origin: shipment.from,
        destination: shipment.to,
        weightKg: shipment.weightKg,
        plannedShippingDate: moment(shipment.shipDate).format('YYYY-MM-DD'),
      });
      return data.products.map((p) => ({
        carrier: 'dhl',
        service: p.productName,
        price: Number(p.totalPrice[0].price),
        currency: p.totalPrice[0].priceCurrency,
        deliveryBy: moment(p.deliveryCapabilities.estimatedDeliveryDateAndTime).toISOString(),
      }));
    },
    async label(shipment) {
      if (!multipartLabels) {
        const { data } = await http.post('/shipments', shipment);
        return { trackingNumber: data.shipmentTrackingNumber, labelUrl: data.documents[0].url };
      }
      const form = new FormData();
      form.append('shipment', JSON.stringify(shipment), { contentType: 'application/json' });
      const { data } = await http.post('/shipments', form, { headers: form.getHeaders() });
      return { trackingNumber: data.shipmentTrackingNumber, labelUrl: data.documents[0].url };
    },
    async track(trackingNumber) {
      const { data } = await http.get('/track/shipments', { params: { trackingNumber } });
      return (data.shipments[0] || { events: [] }).events.map((e) => ({ code: e.statusCode.toUpperCase(), timestamp: e.timestamp, location: e.location && e.location.address.addressLocality }));
    },
  };
};
