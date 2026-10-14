// Only allow redirects back into our own app: a single leading slash, no scheme,
// no protocol-relative "//host", no backslash tricks.
module.exports = function safeRedirect(target, fallback = '/portal') {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return fallback;
  try {
    const url = new URL(target, 'http://shiptrack.invalid');
    return url.origin === 'http://shiptrack.invalid' ? url.pathname + url.search + url.hash : fallback;
  } catch (e) {
    return fallback;
  }
};
