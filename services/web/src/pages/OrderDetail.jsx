import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import StatusBadge from '../components/StatusBadge';
import { money, when } from '../format';

function ShipForm({ reference, onShipped }) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/orders/${reference}/ship`, { trackingNumber: trackingNumber.trim() });
      onShipped(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="row">
      <label>
        Tracking number
        <input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="1Z999AA10123456784" />
      </label>
      <button type="submit" disabled={busy || !trackingNumber.trim()}>
        {busy ? 'Shipping…' : 'Mark shipped & email customer'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function Attachments({ reference }) {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/orders/${reference}/attachments`).then((res) => setFiles(res.data.files)).catch((err) => setError(errorMessage(err)));
  }, [reference]);
  useEffect(load, [load]);

  async function upload(e) {
    e.preventDefault();
    const form = new FormData();
    Array.from(selected).forEach((f) => form.append('files', f));
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/orders/${reference}/attachments`, form);
      setFiles(res.data.files);
      setSelected([]);
      e.target.reset();
    } catch (err) {
      setError(err.response && err.response.status === 413 ? 'Files must be 5 MB or smaller (max 5 at a time).' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {files.length ? (
        <ul>
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No attachments.</p>
      )}
      <form onSubmit={upload} className="row">
        <input type="file" multiple onChange={(e) => setSelected(e.target.files)} aria-label="Choose files" />
        <button type="submit" className="secondary" disabled={busy || !selected.length}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Notes({ reference }) {
  const [notes, setNotes] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/orders/${reference}/notes`).then((res) => setNotes(res.data.data)).catch((err) => setError(errorMessage(err)));
  }, [reference]);

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post(`/orders/${reference}/notes`, { text });
      setNotes([...notes, res.data]);
      setText('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      {notes.length === 0 && <p className="muted">No notes yet.</p>}
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id}>
            <div className="muted small">
              {n.author} · {when(n.createdAt)}
            </div>
            <p>{n.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={add}>
        <label>
          Add a note
          <textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Customer asked for Saturday delivery" />
        </label>
        <button type="submit" className="secondary" disabled={!text.trim()}>
          Save note
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default function OrderDetail() {
  const { reference } = useParams();
  const [order, setOrder] = useState(null);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api
      .get(`/orders/${reference}`)
      .then((res) => setOrder(res.data))
      .catch((err) => setError(err.response && err.response.status === 404 ? `Order ${reference} doesn't exist.` : errorMessage(err)));
    api.get(`/orders/${reference}/plan`).then((res) => setPlan(res.data.plan)).catch(() => setPlan(null));
  }, [reference]);

  async function download(path, filename, type) {
    setNotice('');
    try {
      const res = path.endsWith('/customs') ? await api.post(path, null, { responseType: 'blob' }) : await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice(err.response && err.response.status === 404 ? 'No label has been generated for this order yet.' : errorMessage(err));
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!order) return <p className="muted">Loading…</p>;

  return (
    <section>
      <p>
        <Link to="/orders">← All orders</Link>
      </p>
      <div className="row between">
        <h2>
          {order.reference} <StatusBadge status={order.status} />
        </h2>
        <div className="row">
          <button type="button" className="secondary" onClick={() => download(`/orders/${reference}/label`, `${reference}-label.pdf`, 'application/pdf')}>
            Download label
          </button>
          <button type="button" className="secondary" onClick={() => download(`/orders/${reference}/customs`, `${reference}-customs.xml`, 'application/xml')}>
            Customs declaration
          </button>
        </div>
      </div>
      {notice && <p className="error">{notice}</p>}

      <div className="grid">
        <div className="card">
          <h3>Details</h3>
          <dl>
            <dt>Customer</dt>
            <dd>{order.customerEmail}</dd>
            <dt>Destination</dt>
            <dd>
              {order.destination.country} {order.destination.postcode}
            </dd>
            <dt>Created</dt>
            <dd>{when(order.createdAt)}</dd>
            <dt>Tracking</dt>
            <dd>{order.trackingNumber || '-'}</dd>
          </dl>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.sku}>
                  <td>{i.sku}</td>
                  <td>{i.quantity}</td>
                  <td>{money(i.unitPrice)}</td>
                  <td>{money(i.quantity * i.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="right">
            <strong>{money(order.total)}</strong>
          </p>
        </div>

        <div className="card">
          <h3>Fulfilment</h3>
          {plan ? (
            <ul>
              {Object.entries(plan).map(([warehouse, skus]) => (
                <li key={warehouse}>
                  <strong>{warehouse}</strong>: {skus.join(', ')}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No routing plan.</p>
          )}
          {order.status === 'pending' || order.status === 'label_created' ? (
            <ShipForm
              reference={reference}
              onShipped={(o) => {
                setOrder(o);
                setNotice('');
              }}
            />
          ) : (
            <p className="muted">This order has shipped.</p>
          )}
        </div>

        <div className="card">
          <h3>Attachments</h3>
          <Attachments reference={reference} />
        </div>

        <div className="card">
          <h3>Notes</h3>
          <Notes reference={reference} />
        </div>
      </div>
    </section>
  );
}
