import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import validator from 'validator';
import { useAuth } from '../auth';
import { errorMessage } from '../api';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/orders" replace />;

  async function submit(e) {
    e.preventDefault();
    if (!validator.isEmail(email)) return setError('Enter a valid email address.');
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate((location.state && location.state.from) || '/orders', { replace: true });
    } catch (err) {
      setError(err.response && err.response.status === 401 ? 'Email or password is incorrect.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit} noValidate>
        <h1>ShipTrack</h1>
        <p className="muted">Sign in to the operations console</p>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
