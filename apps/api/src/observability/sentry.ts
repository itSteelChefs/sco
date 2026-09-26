import * as Sentry from '@sentry/nestjs';
import { sanitizeSentryEvent } from './telemetry.js';

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE ?? process.env.SCO_RELEASE_SHA,
    tracesSampleRate: 0,
    beforeSend: (event) => sanitizeSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => sanitizeSentryEvent(breadcrumb),
  });
}