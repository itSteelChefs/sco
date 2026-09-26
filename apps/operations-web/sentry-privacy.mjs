const sensitiveKey = /(?:authorization|cookie|password|secret|token|api[_-]?key|access[_-]?key|database[_-]?url|dsn|storage[_-]?key|document|payload|body|commercial|payment|supplier|message)/i;
const credentialUrl = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi;
const bearerToken = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const secretAssignment = /\b(password|secret|token|cookie|session|api[_-]?key|access[_-]?key|database_url|dsn)=([^\s&]+)/gi;
const urlKey = /(?:url|uri|href)$/i;

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return value.replace(credentialUrl, '$1[REDACTED]@').replace(bearerToken, 'Bearer [REDACTED]').replace(secretAssignment, '$1=[REDACTED]').slice(0, 2048);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 5 || seen.has(value)) return '[REDACTED]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
    key,
    sensitiveKey.test(key) ? '[REDACTED]' : urlKey.test(key) && typeof item === 'string'
      ? sanitize(item.split(/[?#]/)[0], depth + 1, seen)
      : sanitize(item, depth + 1, seen),
  ]));
}

export function sanitizeSentryEvent(event) {
  const sanitized = sanitize(event);
  if (sanitized.request && typeof sanitized.request === 'object') {
    const url = typeof sanitized.request.url === 'string' ? sanitized.request.url.split('?')[0] : undefined;
    sanitized.request = { method: sanitized.request.method, url };
  }
  if (sanitized.exception && Array.isArray(sanitized.exception.values)) sanitized.exception.values = sanitized.exception.values.map((item) => ({ ...item, value: '[REDACTED]' }));
  delete sanitized.user;
  return sanitized;
}