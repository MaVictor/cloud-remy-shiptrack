import moment from 'moment';

export function money(value) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(value || 0);
}

export function when(iso) {
  if (!iso) return '-';
  const m = moment(iso);
  return `${m.format('D MMM YYYY, HH:mm')} (${m.fromNow()})`;
}
