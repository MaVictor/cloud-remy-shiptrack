import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">ShipTrack</span>
        <nav>
          <NavLink to="/orders" end>
            Orders
          </NavLink>
          <NavLink to="/orders/new">New order</NavLink>
          {user.role === 'admin' && <NavLink to="/reports">Reports</NavLink>}
        </nav>
        <span className="who">
          {user.email}
          <button type="button" className="link" onClick={logout}>
            Sign out
          </button>
        </span>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
