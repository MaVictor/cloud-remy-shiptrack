const crypto = require('crypto');
const { promisify } = require('util');
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');

const scrypt = promisify(crypto.scrypt);

// Customer accounts for the self-service portal. Staff accounts live in services/users.js.
const accounts = new Map();
const resetTokens = new Map();
const apiKeys = new Map();

const PROFILE_FIELDS = ['name', 'phone', 'company', 'defaultCountry'];
const RESET_TTL_MS = 30 * 60 * 1000;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function publicView(a) {
  return { id: a.id, email: a.email, ..._pick(a, PROFILE_FIELDS), createdAt: a.createdAt };
}

function _pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

async function register(email, password) {
  if (!validator.isEmail(String(email))) throw Object.assign(new Error('invalid email'), { status: 422 });
  if (typeof password !== 'string' || password.length < 12) throw Object.assign(new Error('password must be at least 12 characters'), { status: 422 });
  const normalized = validator.normalizeEmail(email);
  for (const a of accounts.values()) {
    if (a.email === normalized) throw Object.assign(new Error('account exists'), { status: 409 });
  }
  const account = { id: `c-${uuidv4()}`, email: normalized, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
  accounts.set(account.id, account);
  return publicView(account);
}

async function authenticate(email, password) {
  const normalized = validator.isEmail(String(email)) ? validator.normalizeEmail(email) : null;
  const account = normalized && Array.from(accounts.values()).find((a) => a.email === normalized);
  // Hash even when the account is missing so response time doesn't reveal which emails exist.
  const ok = await verifyPassword(String(password), account ? account.passwordHash : await hashPassword('dummy-password-xx'));
  return ok && account ? publicView(account) : null;
}

function updateProfile(id, patch) {
  const account = accounts.get(id);
  if (!account) return null;
  for (const field of PROFILE_FIELDS) {
    if (patch[field] === undefined) continue;
    const value = String(patch[field]).trim().slice(0, 120);
    if (field === 'phone' && value && !validator.isMobilePhone(value, 'any')) throw Object.assign(new Error('invalid phone'), { status: 422 });
    if (field === 'defaultCountry' && value && !validator.isISO31661Alpha2(value)) throw Object.assign(new Error('invalid country'), { status: 422 });
    account[field] = value;
  }
  return publicView(account);
}

// Returns the raw token for emailing. Only its hash is stored. Unknown emails get a token
// that is never stored, so the caller can't tell whether the account exists.
function requestPasswordReset(email, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('base64url');
  const normalized = validator.isEmail(String(email)) ? validator.normalizeEmail(email) : null;
  const account = normalized && Array.from(accounts.values()).find((a) => a.email === normalized);
  if (account) resetTokens.set(sha256(token), { accountId: account.id, expiresAt: now + RESET_TTL_MS });
  return { token, delivered: Boolean(account) };
}

async function resetPassword(token, newPassword, now = Date.now()) {
  const key = sha256(String(token));
  const entry = resetTokens.get(key);
  resetTokens.delete(key);
  if (!entry || entry.expiresAt < now) return false;
  if (typeof newPassword !== 'string' || newPassword.length < 12) throw Object.assign(new Error('password must be at least 12 characters'), { status: 422 });
  const account = accounts.get(entry.accountId);
  account.passwordHash = await hashPassword(newPassword);
  for (const [k, v] of resetTokens) if (v.accountId === account.id) resetTokens.delete(k);
  return true;
}

// API keys are shown once. We keep a lookup prefix and a hash of the secret.
function createApiKey(accountId, label) {
  const prefix = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(24).toString('base64url');
  apiKeys.set(prefix, { accountId, label: String(label || '').slice(0, 60), hash: sha256(secret), createdAt: new Date().toISOString() });
  return { key: `stk_${prefix}_${secret}`, prefix };
}

function verifyApiKey(key) {
  const m = /^stk_([0-9a-f]{8})_([A-Za-z0-9_-]{32})$/.exec(String(key));
  if (!m) return null;
  const entry = apiKeys.get(m[1]);
  if (!entry) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(sha256(m[2]), 'hex'), Buffer.from(entry.hash, 'hex'));
  return ok ? entry.accountId : null;
}

function revokeApiKey(accountId, prefix) {
  const entry = apiKeys.get(prefix);
  if (!entry || entry.accountId !== accountId) return false;
  return apiKeys.delete(prefix);
}

function clear() {
  accounts.clear();
  resetTokens.clear();
  apiKeys.clear();
}

module.exports = { register, authenticate, updateProfile, requestPasswordReset, resetPassword, createApiKey, verifyApiKey, revokeApiKey, clear };
