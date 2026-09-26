import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
    console.info(JSON.stringify({ timestamp: new Date().toISOString(), severity: 'info', service: 'sco-operations-web', environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development', release: process.env.SENTRY_RELEASE ?? process.env.SCO_RELEASE_SHA ?? 'unknown', event: 'runtime_started' }));
  }
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
}

export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  try {
    return Sentry.captureRequestError(...args);
  } catch {
    return undefined;
  }
};