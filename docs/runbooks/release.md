# Release Runbook

## GitHub Bootstrap

The following remote-only actions are required before release execution:

1. The private GitHub repository `itSteelChefs/sco`, its `origin` remote, and the initial push to `main` are established.
2. Require the CI checks from `.github/workflows/ci.yml` on `main`, prohibit force pushes, and require reviewed pull requests.
3. Keep the `api`, `partner-web`, and `operations-web` GHCR packages private and grant workflow read/write access.
4. Do not grant GitHub Actions VPS access or any deployment private key. Production deployment is disabled in the workflow.
5. Configure the dedicated staging host only after Batch 6-C host onboarding is separately approved.

Do not enable `DEPLOY_ENABLED` until the corresponding host has passed an isolated onboarding test.

## Deployment Authority Setup

The established deployment SSH identity is separate from FCI-01 and every human signing or administration key. Its public key is the sole entry in `/home/sco-deploy/.ssh/authorized_keys`, and the deployment connection has been tested successfully. Do not generate, rotate, replace, or copy the corresponding private key. It is Owner-laptop-only and must never be sent through chat, committed, copied to the VPS, or stored in GitHub Secrets, GitHub Environments, GitHub Actions, CI artifacts, backups, or documentation. GitHub Actions must never SSH to the VPS.

The trusted Staging host ED25519 key, captured locally on 2026-09-28, is:

```text
168.231.112.92 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEHJMEmw1yuCVkW9ytU9zPV2AXyHC8pBCrBgZa41+Vra
```

Its independently verifiable fingerprint is `SHA256:gYuR0C0ZajLSgXW1jCOW2IRUx9YHTlff4QhPyQ/fnKg`. Use the exact line as `DEPLOY_KNOWN_HOSTS`; the transport requires `StrictHostKeyChecking=yes` and a dedicated known-hosts file.

The repository remote is `git@github.com:itSteelChefs/sco.git`, and `origin/main` is the accepted commit `4c1e6f3dc0a53e3b99e722ba1494b6cd3eebbb60`. GitHub authentication uses Owner-controlled SSH agent forwarding; the agent is session-scoped and unavailable in ordinary host sessions, which does not authorize replacing the deployment identity. GitHub Actions may test, run security gates, build, publish immutable GHCR images, and publish release metadata, but it has no deployment Environment and no VPS transport. Production remains disabled.

The FCI-01 Founder signing key is not a deployment key. GitHub Verified status remains a separate Owner signing-key registration task; do not amend, re-sign, or rewrite accepted history to change that display.

## Owner Laptop Deployment Contract

The release workflow requires no GitHub Environment deployment secrets or variables. `PARTNER_WEB_SENTRY_DSN` and `OPERATIONS_WEB_SENTRY_DSN` remain optional repository variables for image build-time browser telemetry; they are not VPS credentials.

Use these approved Staging values:

| Name | Value |
| --- | --- |
| `DEPLOY_ENABLED` | `false` until S3, all local payloads, and Owner review are complete; then exactly `true` for one Owner-laptop deployment invocation |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_PATH` | `/srv/sco/staging/releases/current` |
| `DEPLOY_NETWORK` | `sco` |
| `DEPLOY_BIND_ADDRESS` | `127.0.0.1` |
| `API_PORT` | `3101` |
| `PARTNER_PORT` | `3102` |
| `OPERATIONS_PORT` | `3103` |

Set `DEPLOY_HOST` to `168.231.112.92` and `DEPLOY_USER` to `sco-deploy` in the Owner-laptop process only. Keep the verified host-key line in an Owner-laptop `DEPLOY_KNOWN_HOSTS_FILE`, and keep `DEPLOY_RUNTIME_ENV_FILE`, `DEPLOY_MIGRATION_ENV_FILE`, and `DEPLOY_WEB_ENV_FILE` in protected local files. The Owner laptop must provide an SSH agent containing the established deployment key and an Owner-held read-only GHCR credential through `GHCR_TOKEN`; neither is persisted on the VPS.

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

For S3, `SCO_S3_REGION`, `SCO_S3_BUCKET`, `SCO_S3_ACCESS_KEY_ID`, and `SCO_S3_SECRET_ACCESS_KEY` are required. Add `SCO_S3_ENDPOINT` and `SCO_S3_FORCE_PATH_STYLE=true` only when the selected provider requires them; add `SCO_S3_SESSION_TOKEN` only for temporary credentials. Do not use placeholders or enable deployment before real Staging values exist.

To prepare deployment payloads, use an Owner-administered SFTP session with verified host identity to download `/srv/sco/staging/secrets/migration.env` and `runtime.env` directly to an encrypted Owner-controlled PC. Do not display them with `cat`, copy them through chat, or retain command transcripts. Assemble protected local payload files, add a newly generated `SESSION_SECRET` and the approved S3 values to the runtime payload, and remove transferred working copies after verification. Do not alter the protected source files on the host.

After GitHub Actions publishes and records the three immutable digest references, the Owner verifies the successful CI run and release metadata, starts the laptop SSH agent containing the established deployment key, and runs `scripts/deploy/deploy-from-owner-laptop.sh` with the full release SHA and those exact three digest references. The script rejects GitHub Actions, a disabled `DEPLOY_ENABLED`, an absent agent, a changed host key, non-digest images, missing S3 configuration, non-Staging payloads, and public service bindings. It uploads only the host release script and mode-`0600` payload files, runs migrations before application containers, and retains the existing rollback behavior.

The current authorized key does not use `restrict`. The release transport requires no forwarding, PTY, or user startup files, so `restrict` is semantically compatible with its SSH and SCP commands. Do not alter `authorized_keys` until the Owner-laptop agent is available for an immediate end-to-end post-change transport test.

## Co-resident Staging Profile

On the approved shared Staging host, the release script applies fixed Docker bounds: API is limited to 768 MiB, a 512 MiB reservation, 0.75 CPU, and 256 PIDs; each web container is limited to 384 MiB, a 256 MiB reservation, 0.35 CPU, and 128 PIDs. The PostgreSQL 17 Staging container is provisioned separately and must have its own bounded resource configuration, private network-only exposure, and dedicated volume; it is not created by the release script.

Measure host availability before deployment and after each rollout stage. Do not run performance workloads while interactive development tooling materially reduces host headroom. Do not stop or reconfigure co-resident services to create capacity.

### Local Staging Foundation Evidence

The Owner-approved Batch 6-C local foundation was verified on 2026-09-28 at commit `4c1e6f3dc0a53e3b99e722ba1494b6cd3eebbb60`:

- `sco-deploy` has a locked password, one tested dedicated deployment public key, no sudo grant, and owns only the Staging deployment tree. It has the interactive shell required by the Owner-laptop release transport and belongs to the `docker` group because the approved scripts invoke Docker directly. Docker group access is root-equivalent and must not be treated as a narrow privilege. Deployment remains disabled until immutable image publication and an explicitly approved Owner-laptop invocation.
- `/srv/sco/staging` contains `config`, `compose`, `state`, `logs`, `backups`, and `releases` at mode `0750`; `secrets` is mode `0700`. The tree is owned by `sco-deploy`, while `/srv/sco` remains root-owned.
- `sco-staging-postgres` runs PostgreSQL 17 on the private `sco` Docker network with volume `sco_staging_postgres_data`, restart policy `unless-stopped`, no published port, a health check, 512 MiB memory limit, 256 MiB reservation, 0.50 CPU, and 128 PID limit. The protected development PostgreSQL container and volume are unchanged.
- The `sco_migrator` administrative identity owns the Staging schema and is the only application credential authorized for migrations. `sco_runtime` and `sco_internal_executor` are login roles with no superuser, database creation, role creation, replication, `BYPASSRLS`, role membership, or table ownership. A backup identity is deferred until the external backup destination and credentials are approved.
- Database credentials were generated locally with a cryptographically secure generator. `/srv/sco/staging/secrets/postgres.env`, `migration.env`, and `runtime.env` are owned by `sco-deploy` at mode `0600`; no external provider values are present. The temporary role-provisioning secret was removed after activation.
- Garage v2.4.1 is the accepted Staging S3-compatible store. Its private bucket, dedicated volume, runtime read/write identity, internal-only `sco` network exposure, and real authorized `PutObject`/`GetObject` validation are complete.
- Operations private management is accepted after the Owner Office-PC tunnel validation. The dedicated SSH tunnel account permits only its local Operations listener; public `operations.staging.sco.sa` remains denied.
- Prisma migration integrity and deployment passed for exactly 81 migrations. The ledger is complete through `0081_supplier_future_demand_framework_tier_ordinality_fix`, with no failed or partial migration and no migration `0082`.
- Direct Staging RLS, tenant-context, and role-privilege checks passed 2 files / 9 tests. The destructive security gate and cross-domain adversarial gate passed against an isolated disposable PostgreSQL 17 database: 2 files / 21 tests. The disposable database and credentials were removed; persistent Staging contains no test Company or User rows.
- Post-provisioning idle evidence showed about 62 MiB PostgreSQL memory use, 3.7 GiB host memory available, no OOM, and no container restart. Existing swap allocation alone is not a failure condition. Odoo, Nginx, Docker, and the existing edge routes remained healthy, and no new host listener was introduced.

Local foundation completion does not close Batch 6-C. Remaining actions are immutable GHCR image publication and Owner-laptop deployment validation. Application images must not be deployed until those actions complete, and public Operations remains denied.

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
- **Secret/configuration failure:** rotate exposed material if necessary, correct only the affected Owner-held deployment payload, and rerun approval. Never copy staging secrets to Production.
- **SSH host-key mismatch:** stop. Verify the host out of band and update `DEPLOY_KNOWN_HOSTS` only after authorized confirmation.

Production database rollback, DNS changes, reverse-proxy changes, host provisioning, and object-storage administration require separate authorization. Batch 6-C owns host provisioning and must not begin from this runbook alone.
