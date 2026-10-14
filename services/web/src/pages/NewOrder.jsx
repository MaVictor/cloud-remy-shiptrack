import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import validator from 'validator';
import { api, errorMessage } from '../api';
import { money } from '../format';

const emptyItem = () => ({ sku: '', quantity: 1, unitPrice: '' });

export function validateOrder(form) {
  const problems = {};
  if (!validator.isEmail(form.customerEmail)) problems.customerEmail = 'Enter a valid email address.';
  if (!validator.isISO31661Alpha2(form.country.toUpperCase())) problems.country = 'Use a two-letter country code, like GB or DE.';
  if (!form.postcode.trim()) problems.postcode = 'Postcode is required.';
  form.items.forEach((item, i) => {
    if (!/^[A-Za-z0-9-]{4,32}$/.test(item.sku)) problems[`sku${i}`] = 'SKU is 4–32 letters, numbers or dashes.';
    if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) problems[`quantity${i}`] = 'At least 1.';
    if (item.unitPrice === '' || Number(item.unitPrice) < 0 || Number.isNaN(Number(item.unitPrice))) problems[`unitPrice${i}`] = 'Enter a price.';
  });
  return problems;
}

export default function NewOrder() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ customerEmail: '', country: '', postcode: '', items: [emptyItem()] });
  const [problems, setProblems] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const setItem = (i, field) => (e) => setForm({ ...form, items: form.items.map((item, j) => (j === i ? { ...item, [field]: e.target.value } : item)) });
  const total = form.items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);

  async function submit(e) {
    e.preventDefault();
    const found = validateOrder(form);
    setProblems(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/orders', {
        customerEmail: form.customerEmail.trim(),
        destination: { country: form.country.toUpperCase(), postcode: form.postcode.trim() },
        items: form.items.map((i) => ({ sku: i.sku.toUpperCase(), quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) })),
      });
      navigate(`/orders/${res.data.reference}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const field = (name) => problems[name] && <span className="field-error">{problems[name]}</span>;

  return (
    <section>
      <h2>New order</h2>
      <form className="card wide" onSubmit={submit} noValidate>
        <fieldset>
          <legend>Customer</legend>
          <label>
            Email
            <input type="email" value={form.customerEmail} onChange={set('customerEmail')} placeholder="jamie@example.com" />
            {field('customerEmail')}
          </label>
          <div className="row">
            <label>
              Country
              <input value={form.country} onChange={set('country')} maxLength={2} placeholder="GB" />
              {field('country')}
            </label>
            <label>
              Postcode
              <input value={form.postcode} onChange={set('postcode')} maxLength={16} placeholder="EC1A 1BB" />
              {field('postcode')}
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Items</legend>
          {form.items.map((item, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div className="row item" key={i}>
              <label>
                SKU
                <input value={item.sku} onChange={setItem(i, 'sku')} placeholder="BOX-SMALL" />
                {field(`sku${i}`)}
              </label>
              <label className="narrow">
                Qty
                <input type="number" min="1" value={item.quantity} onChange={setItem(i, 'quantity')} />
                {field(`quantity${i}`)}
              </label>
              <label className="narrow">
                Unit price (€)
                <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={setItem(i, 'unitPrice')} />
                {field(`unitPrice${i}`)}
              </label>
              {form.items.length > 1 && (
                <button type="button" className="link danger" onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })}>
            Add item
          </button>
        </fieldset>

        <div className="row between">
          <strong>Total: {money(total)}</strong>
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create order'}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
