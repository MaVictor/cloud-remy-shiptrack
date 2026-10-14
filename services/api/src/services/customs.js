const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');
const xpath = require('xpath');

// Customs declarations are filed as signed XML (XMLDSig, RSA-SHA256) with the
// destination authority. The signing key is our registered trader certificate.
const C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const DECLARATION = "//*[local-name(.)='Declaration']";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDeclaration(order, trader) {
  const lines = order.items
    .map(
      (i, n) =>
        `<Line n="${n + 1}"><Sku>${escapeXml(i.sku)}</Sku><Quantity>${i.quantity}</Quantity><Value currency="EUR">${(
          i.quantity * i.unitPrice
        ).toFixed(2)}</Value></Line>`
    )
    .join('');
  return (
    `<CustomsFiling xmlns="urn:shiptrack:customs:v1"><Declaration id="${escapeXml(order.reference)}">` +
    `<Trader eori="${escapeXml(trader.eori)}">${escapeXml(trader.name)}</Trader>` +
    `<Destination>${escapeXml(order.destination.country)}</Destination>${lines}</Declaration></CustomsFiling>`
  );
}

function sign(xml, privateKey) {
  const sig = new SignedXml({ privateKey });
  sig.addReference({
    xpath: DECLARATION,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', C14N],
  });
  sig.canonicalizationAlgorithm = C14N;
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.computeSignature(xml);
  return sig.getSignedXml();
}

function verify(signedXml, publicKey) {
  const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
  const signature = xpath.select(
    "//*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']",
    doc
  )[0];
  if (!signature) return false;
  const sig = new SignedXml({ publicCert: publicKey });
  sig.loadSignature(signature);
  return sig.checkSignature(signedXml);
}

module.exports = { buildDeclaration, sign, verify };
