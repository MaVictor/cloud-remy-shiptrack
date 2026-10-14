const FormData = require('form-data');
const axios = require('axios');
const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');
const xpath = require('xpath');

// Signed declarations are produced by the API; the worker re-verifies them before
// filing, because the authority rejects (and fines) malformed submissions.
function verifyDeclaration(xml, publicKey) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const node = xpath.select("//*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']", doc)[0];
  if (!node) return { ok: false, reason: 'unsigned' };
  const sig = new SignedXml({ publicCert: publicKey });
  sig.loadSignature(node);
  const ok = sig.checkSignature(xml);
  const reference = xpath.select("string(//*[local-name(.)='Declaration']/@id)", doc);
  return ok ? { ok, reference } : { ok, reason: 'bad_signature', reference };
}

async function submit(xml, reference, { baseURL, apiKey }) {
  const form = new FormData();
  form.append('declarant', 'GB123456789000');
  form.append('reference', reference);
  form.append('document', Buffer.from(xml), { filename: `${reference}.xml`, contentType: 'application/xml' });
  const res = await axios.post(`${baseURL}/v1/declarations`, form, {
    headers: { ...form.getHeaders(), Authorization: `ApiKey ${apiKey}` },
    timeout: 20000,
  });
  return res.data;
}

async function run({ config, pending, publicKey, apiKey = process.env.CUSTOMS_API_KEY || '' }) {
  const results = { submitted: [], rejected: [] };
  for (const xml of pending) {
    const check = verifyDeclaration(xml, publicKey);
    if (!check.ok) {
      results.rejected.push({ reference: check.reference, reason: check.reason });
      continue;
    }
    const receipt = await submit(xml, check.reference, { baseURL: config.customsAuthorityUrl, apiKey });
    results.submitted.push({ reference: check.reference, mrn: receipt.mrn });
  }
  return results;
}

module.exports = { name: 'customs-submit', every: '5m', run, verifyDeclaration };
