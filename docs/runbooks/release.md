# Release Runbook

## GitHub Bootstrap

An Owner or repository administrator must complete these remote-only actions before release execution:

1. Create the private GitHub repository and configure its Git remote.
2. Require the CI checks from `.github/workflows/ci.yml` on `main`, prohibit force pushes, and require reviewed pull requests.
3. Keep the `api`, `partner-web`, and `operations-web` GHCR packages private and grant workflow read/write access.
4. Create `staging` and `production` GitHub Environments with separate values.
5. Require designated reviewers for `production`. Staging approval is optional; Production approval is mandatory.
6. Configure deployment hosts only after host selection and hardening are separately approved.

Do not enable `DEPLOY_ENABLED` until the corresponding host has passed an isolated onboarding test.

## Environment Contract

Configure these GitHub Environment secrets independently in `staging` and `production`:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`
- `DEPLOY_RUNTIME_ENV`
- `DEPLOY_MIGRATION_ENV`
- `DEPLOY_WEB_ENV`

Configure these Environment variables:

- `DEPLOY_ENABLED`: exactly `true` only after onboarding.
- `DEPLOY_PORT`: SSH port; defaults to `22` when omitted.
- `DEPLOY_PATH`: absolute host path for protected deployment files.
- `DEPLOY_NETWORK`: Docker network; defaults to `sco`.
- `DEPLOY_BIND_ADDRESS`: IPv4 host bind address; defaults to `127.0.0.1`. IPv6 binding is not supported by this Batch.
- `API_PORT`, `PARTNER_PORT`, `OPERATIONS_PORT`: host ports; default to `3101`, `3102`, and `3103`.

Optionally configure repository variables `PARTNER_WEB_SENTRY_DSN` and `OPERATIONS_WEB_SENTRY_DSN` to enable browser error reporting. Sentry DSNs are public routing identifiers, not secrets. They are baked into the single promoted image; browser events use the deployment hostname as their environment.

`DEPLOY_RUNTIME_ENV` is a Docker env-file payload. It must include the complete API runtime contract, including:

```text
NODE_ENV=staging-or-production
SCO_DEPLOY_ENVIRONMENT=matching-environment
RUNTIME_DATABASE_URL=environment-specific-value
SCO_INTERNAL_DATABASE_URL=environment-specific-value
SESSION_SECRET=environment-specific-value
SCO_DOCUMENT_STORAGE=s3
SCO_S3_BUCKET=environment-specific-private-bucket
SCO_S3_REGION=environment-specific-value
SCO_S3_ACCESS_KEY_ID=environment-specific-value
SCO_S3_SECRET_ACCESS_KEY=environment-specific-value
SCO_RATE_LIMIT_MAX=owner-approved-application-requests-per-window
SCO_RATE_LIMIT_WINDOW_MS=owner-approved-application-window
SCO_RATE_LIMIT_AUTH_MAX=owner-approved-auth-attempts-per-window
SCO_RATE_LIMIT_AUTH_WINDOW_MS=owner-approved-auth-window
SCO_RATE_LIMIT_HEALTH_MAX=owner-approved-readiness-probes-per-window
SCO_RATE_LIMIT_HEALTH_WINDOW_MS=owner-approved-readiness-window
SCO_RATE_LIMIT_CLIENT_IDENTITY=direct-peer
```

The explicit request limits/windows require separately approved numeric values before enforcement can start. `direct-peer` is valid only when the API socket peer is the actual client; if a reverse proxy/NAT masks clients, do not enable rate limiting until the Owner approves and infrastructure enforces a trusted-proxy boundary. In that topology set `SCO_RATE_LIMIT_ENABLED=false` explicitly; this leaves abuse limiting disabled and must be documented/approved operationally. Forwarded headers are not trusted. Add endpoint, path-style, or session-token settings only when required by the chosen S3-compatible provider. `DEPLOY_RUNTIME_ENV` must not contain the privileged `DATABASE_URL`. `DEPLOY_MIGRATION_ENV` contains only the matching `SCO_DEPLOY_ENVIRONMENT` marker and the privileged `DATABASE_URL` needed by Prisma. `DEPLOY_WEB_ENV` contains the matching environment marker and optional server-side Sentry settings only; it must never contain database, storage, or session credentials. The deployment script enforces these credential boundaries. Never reuse staging credentials in Production.

## Release

1. Confirm the exact commit has a successful CI run from a `push` to protected `main`.
2. Dispatch the `Release` workflow with the full lowercase 40-character commit SHA.
3. Confirm GHCR receives three private SHA-tagged images and the workflow summary records their digests.
4. Staging pulls and deploys those digests, runs migrations first, then passes liveness/readiness.
5. Review staging evidence and approve the protected Production environment.
6. Production deploys the same digests and verifies health. It does not rebuild.

Never use `latest`, a branch name, or a locally rebuilt image as deployment authority.

## Failure Response

- **CI or security failure:** do not dispatch a release; fix the source and obtain a new successful commit SHA.
- **Image publication failure:** no deployment runs. Investigate and remove any incomplete release's partial SHA tags through an authorized GHCR administrative action before retrying; immutable tags must not be overwritten.
- **Migration failure:** application rollout does not begin. Preserve logs without credentials, diagnose against an isolated copy, and prepare a forward migration when required.
- **Readiness failure:** the host script restores preserved application containers. Confirm schema compatibility before relying on that rollback.
- **Partial rollout or interruption:** inspect containers and `com.sco.release.sha` / `com.sco.image.digest` labels, then either complete the exact-digest rollout or restore the preserved containers.
- **Secret/configuration failure:** rotate exposed material if necessary, correct only the affected GitHub Environment, and rerun approval. Never copy staging secrets to Production.
- **SSH host-key mismatch:** stop. Verify the host out of band and update `DEPLOY_KNOWN_HOSTS` only after authorized confirmation.

Production database rollback, DNS changes, reverse-proxy changes, host provisioning, and object-storage administration require separate authorization.
