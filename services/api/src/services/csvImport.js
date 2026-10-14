const orders = require('./orders');

// Bulk order import for merchants moving from spreadsheets.
// Columns: customer_email,country,postcode,sku,quantity,unit_price (one row per line item,
// rows with the same customer_email+postcode are grouped into one order).
const MAX_ROWS = 2000;
const HEADER = ['customer_email', 'country', 'postcode', 'sku', 'quantity', 'unit_price'];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_ROWS + 1) throw Object.assign(new Error(`too many rows (max ${MAX_ROWS})`), { status: 413 });
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function importOrders(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header || header.map((h) => h.trim().toLowerCase()).join(',') !== HEADER.join(',')) {
    throw Object.assign(new Error(`expected header: ${HEADER.join(',')}`), { status: 422 });
  }
  const groups = new Map();
  const errors = [];
  rows.forEach((r, i) => {
    const [email, country, postcode, sku, quantity, unitPrice] = r.map((c) => c.trim());
    const qty = Number(quantity);
    const price = Number(unitPrice);
    if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(price) || price < 0) {
      errors.push({ line: i + 2, error: 'quantity must be a positive integer and unit_price a non-negative number' });
      return;
    }
    const key = `${email.toLowerCase()}|${postcode}`;
    if (!groups.has(key)) groups.set(key, { customerEmail: email, destination: { country: country.toUpperCase(), postcode }, items: [], lines: [] });
    const g = groups.get(key);
    g.items.push({ sku: sku.toUpperCase(), quantity: qty, unitPrice: price });
    g.lines.push(i + 2);
  });

  const created = [];
  for (const g of groups.values()) {
    try {
      created.push(orders.create({ customerEmail: g.customerEmail, destination: g.destination, items: g.items }).reference);
    } catch (err) {
      errors.push({ lines: g.lines, error: err.message });
    }
  }
  return { created, errors };
}

module.exports = { parseCsv, importOrders, MAX_ROWS };
