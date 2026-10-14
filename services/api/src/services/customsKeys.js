const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');

// Production mounts the trader key from the secrets manager. Dev and test get an
// ephemeral key pair so declarations still sign and verify end to end.
let cached = null;

function keys() {
  if (cached) return cached;
  if (config.customs.keyFile) {
    const privateKey = fs.readFileSync(config.customs.keyFile, 'utf8');
    const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    cached = { privateKey, publicKey };
  } else {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    cached = {
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    };
  }
  return cached;
}

module.exports = { privateKey: () => keys().privateKey, publicKey: () => keys().publicKey };
