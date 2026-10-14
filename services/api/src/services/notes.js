const { v4: uuidv4 } = require('uuid');

// Free-text notes agents and customers leave on an order. Stored as plain text and
// always rendered escaped.
const notes = new Map();
const MAX_LENGTH = 2000;

function add(reference, author, text) {
  const body = String(text || '').trim();
  if (!body) throw Object.assign(new Error('note is empty'), { status: 422 });
  if (body.length > MAX_LENGTH) throw Object.assign(new Error(`note exceeds ${MAX_LENGTH} characters`), { status: 422 });
  const note = { id: uuidv4(), reference, author, body, createdAt: new Date().toISOString() };
  if (!notes.has(reference)) notes.set(reference, []);
  notes.get(reference).push(note);
  return note;
}

function list(reference) {
  return notes.get(reference) || [];
}

function clear() {
  notes.clear();
}

module.exports = { add, list, clear, MAX_LENGTH };
