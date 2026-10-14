import { useState } from 'react';
import moment from 'moment';
import { api, errorMessage } from '../api';
import { money } from '../format';

export default function Reports() {
  const [from, setFrom] = useState(moment().subtract(7, 'days').format('YYYY-MM-DD'));
  const [to, setTo] = useState(moment().format('YYYY-MM-DD'));
  const [country, setCountry] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function run(e) {
    e.preventDefault();
    setError('');
    try {
      const params = { from, to };
      if (country) params.country = country.toUpperCase();
      const res = await api.get('/admin/reports/daily', { params });
      setResult(res.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section>
      <h2>Daily report</h2>
      <form className="card wide row" onSubmit={run}>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="narrow">
          Country
          <input value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} placeholder="Any" />
        </label>
        <button type="submit">Run report</button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && (
        <>
          {result.rollup.length === 0 ? (
            <p className="muted">No orders in this window.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Orders</th>
                  <th>Revenue</th>
                  <th>Countries</th>
                </tr>
              </thead>
              <tbody>
                {result.rollup.map((r) => (
                  <tr key={r.day}>
                    <td>{moment(r.day).format('ddd D MMM')}</td>
                    <td>{r.orders}</td>
                    <td>{money(r.revenue)}</td>
                    <td>{r.countries.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details>
            <summary>Warehouse SQL for this window</summary>
            <pre>{result.sql}</pre>
          </details>
        </>
      )}
    </section>
  );
}
