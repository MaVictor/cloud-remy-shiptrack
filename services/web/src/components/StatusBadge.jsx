const LABELS = {
  pending: 'Pending',
  label_created: 'Label created',
  in_transit: 'In transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export default function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{LABELS[status] || status}</span>;
}

export const STATUSES = Object.keys(LABELS);
export { LABELS };
