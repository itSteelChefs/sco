# Observability Runbook

## Local Validation

Run from the repository root:

```bash
corepack pnpm security:workflows
corepack pnpm security:secrets
corepack pnpm security:filesystem
```

The commands require actionlint 1.7.12, gitleaks 8.30.1, and Trivy 0.74.0. `scripts/ci/install-security-tools.sh <directory>` installs pinned official release binaries after SHA-256 verification. Gitleaks scans full history plus tracked and untracked non-ignored files with redaction; ignored local secrets and generated build output are deliberately outside the committable-content scan. Do not remove redaction when collecting diagnostic output.

Build and scan a production image with:

```bash
docker build -f apps/api/Dockerfile -t sco-api:local .
trivy image --scanners vuln,misconfig --image-config-scanners misconfig --severity HIGH,CRITICAL --no-progress --exit-code 1 sco-api:local
```

Use the corresponding Dockerfile and tag for Partner and Operations. Remove local verification images and Trivy report files afterward. Never commit scanner caches or reports.

## Runtime Configuration

API runtime configuration may include:

```text
LOG_LEVEL=info
SCO_METRICS_TOKEN=at-least-32-random-characters
SENTRY_DSN=provider-issued-server-dsn
```

Deployment supplies `SCO_SERVICE_NAME`, `SCO_RELEASE_SHA`, `SENTRY_RELEASE`, and `SENTRY_ENVIRONMENT` from the approved release SHA and GitHub Environment. Do not override those fields inside payload files.

`DEPLOY_WEB_ENV` may contain server-side `SENTRY_DSN` plus the required `SCO_DEPLOY_ENVIRONMENT` marker. It must not contain database, session, storage, or business credentials.

Browser telemetry remains disabled unless the public repository variables `PARTNER_WEB_SENTRY_DSN` and `OPERATIONS_WEB_SENTRY_DSN` are configured. Release builds bake those routing identifiers and the approved commit SHA into the single promoted image; browser events use the deployment hostname as their environment. Do not rebuild between staging and Production to change browser telemetry configuration. Tracing and session replay remain fixed at zero until their payloads receive separate privacy validation.

## Metrics Access

The metrics endpoint is `GET /internal/metrics`. It requires `Authorization: Bearer <SCO_METRICS_TOKEN>` and returns `404` when disabled or unauthorized. Keep it behind a private reverse-proxy route or monitoring network allowlist. Do not expose it through the public business ingress.

A future Prometheus-compatible collector may scrape this endpoint. Configure short timeouts and tolerate replica restarts. The API must remain healthy if scraping stops.

## Log Collection

Docker stdout/stderr is the authoritative application emission channel. Configure a future host/platform collector to:

- parse newline-delimited JSON from the API and preserve Next framework output;
- attach host/container metadata outside the application;
- retain `service`, `environment`, `release`, `event`, and `request_id`;
- enforce encryption in transit, restricted access, retention, rotation, and deletion policy;
- reject or redact unexpected authorization, cookie, body, database, storage, document, payment, supplier, and commercial fields;
- avoid using local container files as durable storage.

No collector or centralized log backend is deployed by this Batch.

## Incident Investigation

1. Start with the affected release SHA, environment, service, time window, and safe request ID.
2. Check `/health/live`; failure indicates process/container failure rather than a dependency diagnosis.
3. Check `/health/ready`; `NOT_READY` indicates a required PostgreSQL dependency failure. Inspect `readiness_failed` events and pool metrics without exposing connection strings.
4. Compare HTTP error rate and latency with CPU, memory, event-loop, and pool waiting/idle signals.
5. Search protected logs and Sentry by request ID and release. Do not paste raw events into tickets until redaction is verified.
6. For storage failures, use operation and error category only. Retrieve storage keys from an authorized business workflow, not telemetry.
7. For repeated 401/403/400 events, aggregate by operation and time. Do not add email, token, user, tenant, IP, or supplier labels without a separate privacy/security decision.
8. Correlate deployment failures with immutable image digest labels and the release workflow. Application rollback does not imply database rollback.

If logs, Sentry, or metrics delivery fails, continue serving business traffic. Telemetry availability is never a readiness condition.

## Future Sentry Setup

An Owner must separately authorize and create the Sentry organization/projects, retention/access policy, DSNs, and CI auth token. Use distinct server DSNs per service/environment where practical. Confirm event scrubbing with synthetic data before enabling Production. Keep tracing at zero until sampling cost and privacy are reviewed. Do not enable session replay by default.

Source-map upload requires a scoped Sentry auth token available only to the image publication job. A future change must pin the upload tooling, avoid exposing the token to pull requests, associate maps with the full release SHA, and preserve the no-rebuild promotion model.

## Future Backends

A centralized log backend requires an approved host collector, transport, tenant-independent access controls, retention, encryption, capacity, and incident-export policy. A metrics backend requires private scrape routing, authentication, retention, replica aggregation, alert ownership, and measured alert thresholds. Neither backend may become an application startup, liveness, or readiness dependency.
