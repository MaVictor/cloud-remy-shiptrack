const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');
const xpath = require('xpath');
const { v4: uuidv4 } = require('uuid');

// PostNord's B2B interface is SOAP with a signed body (XMLDSig, RSA-SHA256).
const C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';

function esc(v) {
  return String(v).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}

function envelope(operation, inner) {
  return (
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:pn="urn:postnord:b2b:v3">' +
    `<soap:Body Id="body-${uuidv4()}"><pn:${operation}>${inner}</pn:${operation}></soap:Body></soap:Envelope>`
  );
}

function signBody(xml, privateKey) {
  const sig = new SignedXml({ privateKey });
  sig.addReference({ xpath: "//*[local-name(.)='Body']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: [C14N] });
  sig.canonicalizationAlgorithm = C14N;
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Envelope']", action: 'prepend' } });
  return sig.getSignedXml();
}

function select(xml, expr) {
  return xpath.select(expr, new DOMParser().parseFromString(xml, 'text/xml'));
}

module.exports = function postnord({ baseURL, signingKeyFile, privateKey }) {
  const key =
    privateKey ||
    (signingKeyFile
      ? fs.readFileSync(signingKeyFile, 'utf8')
      : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const http = axios.create({ baseURL, timeout: 10000, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });

  async function soap(operation, inner) {
    const { data } = await http.post('/b2b/v3', signBody(envelope(operation, inner), key), { headers: { SOAPAction: `urn:postnord:b2b:v3#${operation}` } });
    return data;
  }

  return {
    name: 'postnord',
    async quote(shipment) {
      const xml = await soap('GetPrices', `<pn:From>${esc(shipment.from.country)}</pn:From><pn:To>${esc(shipment.to.country)}</pn:To><pn:WeightKg>${Number(shipment.weightKg)}</pn:WeightKg>`);
      return select(xml, "//*[local-name(.)='Price']").map((n) => ({
        carrier: 'postnord',
        service: n.getAttribute('service'),
        price: Number(n.getAttribute('amount')),
        currency: n.getAttribute('currency'),
        deliveryBy: n.getAttribute('deliveryBy'),
      }));
    },
    async label(shipment) {
      const xml = await soap('CreateShipment', `<pn:Reference>${esc(shipment.reference)}</pn:Reference><pn:To>${esc(shipment.to.country)}</pn:To>`);
      return {
        trackingNumber: xpath.select("string(//*[local-name(.)='ItemId'])", new DOMParser().parseFromString(xml, 'text/xml')),
        labelUrl: xpath.select("string(//*[local-name(.)='LabelUrl'])", new DOMParser().parseFromString(xml, 'text/xml')),
      };
    },
    async track(trackingNumber) {
      const xml = await soap('GetTracking', `<pn:ItemId>${esc(trackingNumber)}</pn:ItemId>`);
      return select(xml, "//*[local-name(.)='Event']").map((n) => ({ code: n.getAttribute('code'), timestamp: n.getAttribute('at'), location: n.getAttribute('location') }));
    },
    signBody: (xml) => signBody(xml, key),
  };
};
module.exports.envelope = envelope;
