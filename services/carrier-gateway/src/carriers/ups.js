const axios = require('axios');
const moment = require('moment');
const _ = require('lodash');

// UPS uses OAuth client credentials; tokens are cached until a minute before expiry.
module.exports = function ups({ baseURL, clientId, clientSecret }) {
  const http = axios.create({ baseURL, timeout: 8000 });
  let token = null;

  async function bearer() {
    if (token && moment().isBefore(token.expiresAt)) return token.value;
    const { data } = await http.post('/security/v1/oauth/token', 'grant_type=client_credentials', {
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    token = { value: data.access_token, expiresAt: moment().add(Number(data.expires_in) - 60, 'seconds') };
    return token.value;
  }

  async function call(method, url, body) {
    const { data } = await http.request({ method, url, data: body, headers: { Authorization: `Bearer ${await bearer()}` } });
    return data;
  }

  return {
    name: 'ups',
    async quote(shipment) {
      const data = await call('post', '/api/rating/v2403/Shop', {
        RateRequest: { Shipment: { ShipFrom: shipment.from, ShipTo: shipment.to, Package: { Weight: shipment.weightKg } } },
      });
      return _.get(data, 'RateResponse.RatedShipment', []).map((r) => ({
        carrier: 'ups',
        service: r.Service.Description,
        price: Number(r.TotalCharges.MonetaryValue),
        currency: r.TotalCharges.CurrencyCode,
        deliveryBy: moment(shipment.shipDate).add(Number(r.GuaranteedDelivery.BusinessDaysInTransit), 'days').toISOString(),
      }));
    },
    async label(shipment) {
      const data = await call('post', '/api/shipments/v2403/ship', { ShipmentRequest: { Shipment: shipment } });
      const result = data.ShipmentResponse.ShipmentResults;
      return { trackingNumber: result.PackageResults.TrackingNumber, labelUrl: result.LabelURL };
    },
    async track(trackingNumber) {
      const data = await call('get', `/api/track/v1/details/${encodeURIComponent(trackingNumber)}`);
      return _.get(data, 'trackResponse.shipment[0].package[0].activity', []).map((a) => ({
        code: a.status.type === 'D' ? 'DL' : 'IT',
        timestamp: moment(`${a.date}${a.time}`, 'YYYYMMDDHHmmss').toISOString(),
        location: _.get(a, 'location.address.city'),
      }));
    },
  };
};
