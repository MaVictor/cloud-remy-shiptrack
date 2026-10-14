import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import StatusBadge, { LABELS, STATUSES } from '../components/StatusBadge';
import { money, when } from '../format';

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setOrders(null);
    api
      .get('/orders', { params: status ? { status } : {} })
      .then((res) => !cancelled && setOrders(res.data.data))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <section>
      <div className="row between">
        <h2>Orders</h2>
        <div className="row">
          <label className="inline">
            Status
            <select value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <Link className="button" to="/orders/new">
            New order
          </Link>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!orders && !error && <p className="muted">Loading orders…</p>}
      {orders && orders.length === 0 && <p className="muted">No orders yet. Create one to get started.</p>}
      {orders && orders.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Customer</th>
              <th>Destination</th>
              <th>Items</th>
              <th>Total</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.reference}>
                <td>
                  <Link to={`/orders/${o.reference}`}>{o.reference}</Link>
                </td>
                <td>{o.customerEmail}</td>
                <td>
                  {o.destination.country} {o.destination.postcode}
                </td>
                <td>{o.items.reduce((n, i) => n + i.quantity, 0)}</td>
                <td>{money(o.total)}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
                <td>{when(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
