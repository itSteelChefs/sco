import pino, { type DestinationStream, type Logger } from 'pino';
import * as Sentry from '@sentry/nestjs';

const sensitiveKey = /(?:authorization|cookie|password|secret|token|api[_-]?key|access[_-]?key|database[_-]?url|dsn|storage[_-]?key|document|payload|body|commercial|payment|supplier|message)/i;
const credentialUrl = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi;
const bearerToken = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const secretAssignment = /\b(password|secret|token|cookie|session|api[_-]?key|access[_-]?key|database_url|dsn)=([^\s&]+)/gi;
const awsAccessKey = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const urlKey = /(?:url|uri|href)$/i;

export const redactText = (value: string): string => value
  .replace(credentialUrl, '$1[REDACTED]@')
  .replace(bearerToken, 'Bearer [REDACTED]')
  .replace(secretAssignment, '$1=[REDACTED]')
  .replace(awsAccessKey, '[REDACTED]')
  .slice(0, 2048);

export function sanitizeTelemetry(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 5 || seen.has(value)) return '[REDACTED]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeTelemetry(item, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
    key,
    sensitiveKey.test(key) ? '[REDACTED]' : urlKey.test(key) && typeof item === 'string'
      ? redactText(item.split(/[?#]/)[0])
      : sanitizeTelemetry(item, depth + 1, seen),
  ]));
}

export const runtimeIdentity = (service = process.env.SCO_SERVICE_NAME ?? 'sco-api') => ({
  service,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  release: process.env.SENTRY_RELEASE ?? process.env.SCO_RELEASE_SHA ?? 'unknown',
});

export function createOperationalLogger(destination?: DestinationStream): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: runtimeIdentity(),
    timestamp: pino.stdTimeFunctions.isoTime,
  }, destination);
}

export const operationalLogger = createOperationalLogger();

export function safeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return sanitizeTelemetry(fields) as Record<string, unknown>;
}

export function sanitizeSentryEvent<T extends object>(event: T): T {
  const sanitized = sanitizeTelemetry(event) as T;
  const record = sanitized as Record<string, unknown>;
  if (record.request && typeof record.request === 'object') {
    const request = record.request as Record<string, unknown>;
    const url = typeof request.url === 'string' ? request.url.split('?')[0] : undefined;
    record.request = { method: request.method, url };
  }
  if (record.exception && typeof record.exception === 'object') {
    const exception = record.exception as { values?: Array<Record<string, unknown>> };
    if (Array.isArray(exception.values)) exception.values = exception.values.map((item) => ({ ...item, value: '[REDACTED]' }));
  }
  delete record.user;
  return sanitized;
}

export function captureOperationalException(error: unknown, context: Record<string, unknown>): void {
  try {
    Sentry.withScope((scope) => {
      scope.setContext('operation', safeFields(context));
      Sentry.captureException(error);
    });
  } catch {
    operationalLogger.warn({ event: 'telemetry_delivery_failed' });
  }
}