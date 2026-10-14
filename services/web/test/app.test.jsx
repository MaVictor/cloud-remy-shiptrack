import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), interceptors: actual.api.interceptors } };
});

const { api } = await import('../src/api');
const { AuthProvider } = await import('../src/auth');
const { default: App } = await import('../src/App');
const { validateOrder } = await import('../src/pages/NewOrder');

const order = {
  reference: 'ST-ABCDEF12',
  customerEmail: 'jamie@example.com',
  status: 'pending',
  destination: { country: 'GB', postcode: 'EC1A 1BB' },
  items: [{ sku: 'BOX-SMALL', quantity: 2, unitPrice: 4.5 }],
  total: 9,
  createdAt: '2026-10-01T10:00:00.000Z',
};

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

function signedIn(role = 'agent') {
  sessionStorage.setItem('shiptrack.token', 'test-token');
  api.get.mockImplementation((url) => {
    if (url === '/auth/me') return Promise.resolve({ data: { id: 'u-200', role, email: 'dana@shiptrack.example.com' } });
    if (url === '/orders') return Promise.resolve({ data: { data: [order] } });
    if (url === `/orders/${order.reference}`) return Promise.resolve({ data: order });
    if (url.endsWith('/plan')) return Promise.resolve({ data: { plan: { 'LON-01': ['BOX-SMALL'] } } });
    if (url.endsWith('/attachments')) return Promise.resolve({ data: { files: ['customs.pdf'] } });
    if (url.endsWith('/notes')) return Promise.resolve({ data: { data: [] } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login', () => {
  it('redirects to login when signed out', async () => {
    renderApp('/orders');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('validates the email before calling the API', async () => {
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid email');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('signs in and lands on the orders list', async () => {
    api.post.mockResolvedValue({ data: { token: 'jwt', user: { id: 'u-200', name: 'Dana', role: 'agent' } } });
    api.get.mockResolvedValue({ data: { data: [order] } });
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'dana@shiptrack.example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'battery-staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('ST-ABCDEF12')).toBeInTheDocument();
    expect(sessionStorage.getItem('shiptrack.token')).toBe('jwt');
  });

  it('shows a friendly message on bad credentials', async () => {
    api.post.mockRejectedValue({ response: { status: 401, data: { error: 'invalid_credentials' } } });
    renderApp('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'dana@shiptrack.example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });
});

describe('orders', () => {
  it('lists orders and filters by status', async () => {
    signedIn();
    renderApp('/orders');
    expect(await screen.findByText('jamie@example.com')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'delivered');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/orders', { params: { status: 'delivered' } }));
  });

  it('hides reports from non-admins', async () => {
    signedIn('agent');
    renderApp('/orders');
    await screen.findByText('jamie@example.com');
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  });
});

describe('new order', () => {
  it('validates fields', () => {
    const problems = validateOrder({ customerEmail: 'x', country: 'ZZ', postcode: '', items: [{ sku: 'a', quantity: 0, unitPrice: '' }] });
    expect(Object.keys(problems).sort()).toEqual(['country', 'customerEmail', 'postcode', 'quantity0', 'sku0', 'unitPrice0']);
  });

  it('submits a multi-item order and opens it', async () => {
    signedIn();
    api.post.mockResolvedValue({ data: order });
    renderApp('/orders/new');
    await userEvent.type(await screen.findByLabelText('Email'), 'jamie@example.com');
    await userEvent.type(screen.getByLabelText('Country'), 'gb');
    await userEvent.type(screen.getByLabelText('Postcode'), 'EC1A 1BB');
    await userEvent.type(screen.getByLabelText('SKU'), 'box-small');
    await userEvent.type(screen.getByLabelText('Unit price (€)'), '4.5');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await userEvent.type(screen.getAllByLabelText('SKU')[1], 'TAPE-50M');
    await userEvent.type(screen.getAllByLabelText('Unit price (€)')[1], '3');
    expect(screen.getByText(/Total:/)).toHaveTextContent('€7.50');
    await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/orders', {
        customerEmail: 'jamie@example.com',
        destination: { country: 'GB', postcode: 'EC1A 1BB' },
        items: [
          { sku: 'BOX-SMALL', quantity: 1, unitPrice: 4.5 },
          { sku: 'TAPE-50M', quantity: 1, unitPrice: 3 },
        ],
      })
    );
    expect(await screen.findByText('Fulfilment')).toBeInTheDocument();
  });
});

describe('order detail', () => {
  it('shows the order, plan and attachments, and saves a note', async () => {
    signedIn();
    api.post.mockResolvedValue({ data: { id: 'n1', author: 'dana@shiptrack.example.com', body: 'Leave with neighbour', createdAt: '2026-10-01T11:00:00.000Z' } });
    renderApp('/orders/ST-ABCDEF12');
    expect(await screen.findByText('LON-01')).toBeInTheDocument();
    expect(screen.getByText('customs.pdf')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Add a note'), 'Leave with neighbour');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByText('Leave with neighbour')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/orders/ST-ABCDEF12/notes', { text: 'Leave with neighbour' });
  });

  it('ships an order with a tracking number', async () => {
    signedIn();
    api.post.mockResolvedValue({ data: { ...order, status: 'in_transit', trackingNumber: '1Z999AA10123456784' } });
    renderApp('/orders/ST-ABCDEF12');
    await userEvent.type(await screen.findByLabelText('Tracking number'), '1Z999AA10123456784');
    await userEvent.click(screen.getByRole('button', { name: /Mark shipped/ }));
    expect(await screen.findByText('In transit')).toBeInTheDocument();
    expect(screen.getByText('This order has shipped.')).toBeInTheDocument();
  });
});
