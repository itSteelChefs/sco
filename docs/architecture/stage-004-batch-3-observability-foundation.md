# Stage 004 Batch 3 - Observability and Security Telemetry Foundation

## Boundaries

This Batch adds application-side observability without adding an observability control plane. PostgreSQL remains authoritative and the modular monolith remains stateless and horizontally scalable. No Elasticsearch, OpenSearch, Loki, Prometheus server, Grafana server, queue, cache, Kubernetes service, external account, or Production integration is created.

Operational telemetry does not replace immutable business audit records. Business actions continue to use the existing PostgreSQL audit boundary. Operational logs and metrics describe runtime outcomes without business payloads.

## Structured Logging

The API emits newline-delimited JSON to stdout/stderr through Pino. Next.js services emit a structured runtime-start event and otherwise retain framework stdout/stderr behavior. Containers do not write authoritative Production log files.

API event fields are bounded and machine-readable:

- `time`, `level`, `service`, `environment`, and `release`;
- `event`, `request_id`, `method`, and bounded controller operation;
- `status` and `duration_ms`;
- safe `error_category` for internal failures.

Request bodies, query values, arbitrary headers, user/tenant/document identifiers, SQL, storage keys, and commercial data are not request-log fields. Sensitive key names are replaced with `[REDACTED]`; credential-bearing URLs, bearer tokens, and secret assignments are redacted. Values, object depth, object width, and arrays are bounded before logging or Sentry delivery.

Security-relevant operational events include `authentication_failed`, `authorization_denied`, `invalid_request`, `request_not_found`, `request_failed`, `unexpected_error`, `readiness_failed`, and `storage_operation_failed`. Aggregated request metrics make repeated failures visible without adding attacker-controlled identity labels.

## Request Correlation

The API accepts `x-correlation-id` only when it is 1-64 characters, starts with an alphanumeric character, and contains only alphanumerics, `.`, `_`, `:`, or `-`. Missing, repeated, oversized, or malformed values are replaced with a server-generated UUID. The accepted/generated identifier is returned as `x-correlation-id` and attached to operational request events.

A correlation ID is diagnostic context, never authentication or authorization authority. Existing domain operations may continue to store it in immutable business audit records where already designed.

## Error Boundary

A global exception filter preserves explicit safe `{ "error": { "code": "..." } }` contracts, including `NOT_READY`. Unknown exceptions return HTTP 500 with only `INTERNAL_ERROR`; stack traces, SQL, credentials, hostnames, filesystem paths, and implementation details are not returned. Detailed sanitized context remains in protected operational telemetry.

## Sentry

The API uses `@sentry/nestjs`; Partner and Operations web use `@sentry/nextjs` server, edge, and browser instrumentation. Initialization is opt-in: no DSN means no external telemetry and no startup failure. Delivery errors do not affect request handling or readiness.

Server settings use `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE`. Browser settings use the corresponding `NEXT_PUBLIC_SENTRY_*` values because browser DSNs are public build configuration. Session replay and tracing are fixed at zero until their emitted fields receive separate privacy validation. No source maps are uploaded and no Sentry auth token is present.

Before Sentry delivery, user context and exception messages are removed; request headers, cookies, bodies/data, and query strings in nested URL fields are discarded; sensitive nested fields and credential URLs are redacted. Confidential commercial, supplier, payment, document, database, and storage material must not be added as custom Sentry context.

Release identity follows Batch 2: deployment forces the full commit SHA into `SCO_RELEASE_SHA` and `SENTRY_RELEASE`, the GitHub Environment into `SENTRY_ENVIRONMENT`, and a fixed service name into `SCO_SERVICE_NAME`. The same digest and release identity move from staging to Production.

## Metrics

The API owns a process-local Prometheus registry. It exports:

- request count by method, bounded controller operation, and status class;
- request latency histogram and in-flight requests;
- Node.js process CPU, memory, event-loop, and runtime signals;
- PostgreSQL runtime/internal pool total, idle, and waiting connections;
- required readiness dependency state;
- private storage read/write failure counts;
- build identity with the immutable release label.

No tenant, user, email, company, supplier, document, storage key, SQL, URL query, or other unbounded label is permitted.

`GET /internal/metrics` is disabled unless `SCO_METRICS_TOKEN` is at least 32 characters. When configured, it requires a timing-safe comparison of a Bearer token and returns `404` to unauthorized callers. It sets `Cache-Control: no-store`. The endpoint is operational, not part of the public business API, and must additionally be restricted by the host reverse proxy or private monitoring network. Metrics availability is not a liveness or readiness dependency.

## Health and Failure Isolation

`/health/live` remains dependency-free. `/health/ready` continues to check only required PostgreSQL services and records bounded dependency state. Sentry, log collectors, and metrics backends are optional and never participate in readiness.

Sentry and future collector/backend failure cannot stop business requests. Local process metrics reset when a replica restarts; a future metrics backend is responsible for aggregation. Docker stdout/stderr is the collection boundary; a future host collector is responsible for transport, retention, access control, and rotation.

## Security Gates

CI installs pinned checksum-verified actionlint 1.7.12, gitleaks 8.30.1, and Trivy 0.74.0 from official releases. It runs:

- actionlint over all workflows;
- gitleaks over full fetched Git history and current content with output redaction;
- Trivy filesystem vulnerability and configuration scanning, including dev/build dependencies;
- Trivy HIGH/CRITICAL vulnerability and image-configuration scanning for all three production images.

Scanner jobs have `contents: read` and no GitHub Environment or Production secrets. HIGH/CRITICAL findings fail CI; policy does not ignore unfixed findings or suppress scanner output to manufacture a green result.

## Performance and Scaling Signals

Future scaling decisions require measured p50/p95/p99 latency, throughput, error rate, CPU, memory, event-loop pressure, PostgreSQL pool saturation, slow-query latency, database CPU/I/O, repeated expensive reads, deployment frequency, and failure-isolation pressure. Queue backlog becomes relevant only if queues are later authorized. No arbitrary threshold is defined before representative measurements exist.
