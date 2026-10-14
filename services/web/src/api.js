import axios from 'axios';

// Session token lives in sessionStorage so a refresh keeps you signed in but closing
// the tab signs you out.
const TOKEN_KEY = 'shiptrack.token';

export const api = axios.create({ baseURL: '/api', timeout: 15000 });

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401 && !err.config.url.endsWith('/auth/login')) onUnauthorized();
    return Promise.reject(err);
  }
);

// Turns an API error into something a person can read.
export function errorMessage(err) {
  const data = err.response && err.response.data;
  if (data && data.details && data.details.length) return data.details.map((d) => d.message).join('; ');
  if (data && data.fields) return `Please check: ${data.fields.join(', ')}`;
  if (data && data.error) return data.error.replace(/_/g, ' ');
  return err.message || 'Something went wrong';
}
