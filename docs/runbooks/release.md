# Release Runbook

## GitHub Bootstrap

An Owner or repository administrator must complete these remote-only actions before release execution:

1. Create the private GitHub repository and configure its Git remote.
2. Require the CI checks from `.github/workflows/ci.yml` on `main`, prohibit force pushes, and require reviewed pull requests.
3. Keep the `api`, `partner-web`, and `operations-web` GHCR packages private and grant workflow read/write access.
4. Create only the `staging` GitHub Environment for this Batch. Production deployment is disabled in the workflow and must not receive deployment values.
5. Require designated Owner reviewers for `staging` before enabling it.
6. Configure the dedicated staging host only after Batch 6-C host onboarding is separately approved.

Do not enable `DEPLOY_ENABLED` until the corresponding host has passed an isolated onboarding test.

## Environment Contract

Configure these GitHub Environment secrets in `staging` only:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`
- `DEPLOY_RUNTIME_ENV`
- `DEPLOY_MIGRATION_ENV`
- `DEPLOY_WEB_ENV`

Configure these `staging` Environment variables:

- `DEPLOY_ENABLED`: exactly `true` only after onboarding.
- `DEPLOY_PORT`: SSH port; defaults to `22` when omitted.
- `DEPLOY_PATH`: absolute host path for protected deployment files.
- `DEPLOY_NETWORK`: Docker network; defaults to `sco`.
- `DEPLOY_BIND_ADDRESS`: must be exactly `127.0.0.1`; the deployment script rejects every other address.
- `API_PORT`, `PARTNER_PORT`, `OPERATIONS_PORT`: host ports; default to `3101`, `3102`, and `3103`.

Optionally configure repository variables `PARTNER_WEB_SENTRY_DSN` and `OPERATIONS_WEB_SENTRY_DSN` to enable browser error reporting. Sentry DSNs are public routing identifiers, not secrets. They are baked into the single promoted image; browser events use the deployment hostname as their environment.

`DEPLOY_RUNTIME_ENV` is a Docker env-file payload. It must include the complete API runtime contract, including:

```text
NODE_ENV=staging
SCO_DEPLOY_ENVIRONMENT=staging
RUNTIME_DATABASE_URL=environment-specific-value
SCO_INTERNAL_DATABASE_URL=environment-specific-value
SESSION_SECRET=environment-specific-value
SCO_DOCUMENT_STORAGE=s3
SCO_S3_BUCKET=environment-specific-private-bucket
SCO_S3_REGION=environment-specific-value
SCO_S3_ACCESS_KEY_ID=environment-specific-value
SCO_S3_SECRET_ACCESS_KEY=environment-specific-value
SCO_TRUST_PROXY=trusted-peers
SCO_TRUSTED_PROXY_PEERS=127.0.0.1
SCO_RATE_LIMIT_CLIENT_IDENTITY=trusted-proxy
SCO_RATE_LIMIT_MAX=120
SCO_RATE_LIMIT_WINDOW_MS=60000
SCO_RATE_LIMIT_AUTH_MAX=20
SCO_RATE_LIMIT_AUTH_WINDOW_MS=60000
SCO_RATE_LIMIT_HEALTH_MAX=120
SCO_RATE_LIMIT_HEALTH_WINDOW_MS=60000
SCO_RATE_LIMIT_MAX_CLIENTS=10000
```

The staging Nginx process is the only trusted peer and must connect from loopback. It replaces `X-Forwarded-For` with the observed client IP; it never appends inbound client headers. The API accepts one forwarded IP only from `127.0.0.1`, and ignores `X-Real-IP`, `Forwarded`, malformed values, and forwarded chains. These numerical limits are Staging-only and are enforced by the deployment script; Production values remain unapproved. Add endpoint, path-style, or session-token settings only when required by the chosen S3-compatible provider. `DEPLOY_RUNTIME_ENV` must not contain the privileged `DATABASE_URL`. `DEPLOY_MIGRATION_ENV` contains only the matching `SCO_DEPLOY_ENVIRONMENT` marker and the privileged `DATABASE_URL` needed by Prisma. `DEPLOY_WEB_ENV` contains the matching environment marker and optional server-side Sentry settings only; it must never contain database, storage, or session credentials. The deployment script enforces these credential boundaries. Never reuse staging credentials in Production.

## Release

1. Confirm the exact commit has a successful CI run from a `push` to protected `main`.
2. Dispatch the `Release` workflow with the full lowercase 40-character commit SHA.
3. Confirm GHCR receives three private SHA-tagged images and the workflow summary records their digests.
4. Staging pulls and deploys those digests, runs migrations first, then passes local liveness/readiness checks.
5. Verify the host renders and validates [infrastructure/nginx/staging-edge.conf.template](../../infrastructure/nginx/staging-edge.conf.template), with its Operations management-plane allow/deny include in place, before enabling public ingress.
6. Review Staging evidence. This workflow has no Production job; Production is disabled.

Never use `latest`, a branch name, or a locally rebuilt image as deployment authority.

## Failure Response

- **CI or security failure:** do not dispatch a release; fix the source and obtain a new successful commit SHA.
- **Image publication failure:** no deployment runs. Investigate and remove any incomplete release's partial SHA tags through an authorized GHCR administrative action before retrying; immutable tags must not be overwritten.
- **Migration failure:** application rollout does not begin. Preserve logs without credentials, diagnose against an isolated copy, and prepare a forward migration when required.
- **Readiness failure:** the host script restores preserved application containers. Confirm schema compatibility before relying on that rollback.
- **Partial rollout or interruption:** inspect containers and `com.sco.release.sha` / `com.sco.image.digest` labels, then either complete the exact-digest rollout or restore the preserved containers.
- **Secret/configuration failure:** rotate exposed material if necessary, correct only the affected GitHub Environment, and rerun approval. Never copy staging secrets to Production.
- **SSH host-key mismatch:** stop. Verify the host out of band and update `DEPLOY_KNOWN_HOSTS` only after authorized confirmation.

Production database rollback, DNS changes, reverse-proxy changes, host provisioning, and object-storage administration require separate authorization. Batch 6-C owns host provisioning and must not begin from this runbook alone.
