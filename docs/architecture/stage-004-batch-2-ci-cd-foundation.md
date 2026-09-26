# Stage 004 Batch 2 - CI/CD and Safe Release Foundation

## Architecture

GitHub Actions is the CI provider and private GitHub Container Registry packages are the artifact authority. CI and release are separate workflows:

1. `.github/workflows/ci.yml` runs on pull requests and pushes to `main` with `contents: read` only.
2. `.github/workflows/release.yml` is manual. It accepts one full commit SHA, proves that SHA belongs to `main`, and requires a successful `push` CI run for that exact SHA.
3. The publish job alone receives `packages: write`. It rejects an existing commit-SHA tag, builds each image once, publishes it, and captures its immutable digest.
4. Staging receives only the three digest references. Production depends on successful staging and uses the same references without rebuilding.
5. The `production` GitHub Environment is the mandatory Owner approval boundary.

Branch protection and GitHub Environment protection are remote administrative controls and cannot be established by repository files. Until the Owner configures them, the workflow definitions are not a complete Production control plane.

## CI Gates

CI uses no deployment secrets and does not use `pull_request_target`. Its jobs provide:

- frozen pnpm installation;
- historical migration integrity and contiguous migration structure checks;
- tracked sensitive-file and Docker-context checks;
- Prisma validation;
- API and web TypeScript/build checks;
- an isolated clean PostgreSQL security gate;
- a separate isolated clean PostgreSQL full suite;
- production Docker builds and non-root runtime checks.

The two database jobs use disposable PostgreSQL services. `scripts/ci/prepare-test-database.mjs` refuses non-test execution and refuses database URLs outside loopback `sco_dev`. It applies migrations from zero, provisions restricted runtime/internal logins, seeds test data, and verifies Prisma status without printing credentials.

## Migration Integrity

`scripts/ci/check-migrations.mjs` compares migration files accepted at the PR base or previous pushed revision with the current tree. Historical deletion, rename, or content modification fails CI. New migrations must retain the four-digit contiguous sequence and contain exactly one non-empty `migration.sql`. The gate derives the accepted count from Git history; it does not freeze the repository at 81 migrations.

Deployment is forward-only:

1. CI validates migrations on a clean database.
2. Release images are published.
3. The exact API image digest runs `prisma migrate deploy` with the environment's migration credential.
4. A failed migration stops deployment before any container replacement.
5. Application containers start only after migration success, then liveness/readiness are verified.

Schema changes must use expand-and-contract compatibility so the previous application remains usable while migrations run. Database rollback is not automated or promised. A failed or incompatible migration requires diagnosis and an authorized forward fix.

## Artifact and Secret Model

Release identity is the full Git commit SHA. Images use `ghcr.io/<repository>/api:<sha>`, `partner-web:<sha>`, and `operations-web:<sha>` for traceability, but deployment accepts only `ghcr.io/...@sha256:<digest>`. `latest` is never produced or consumed. Existing SHA tags are not overwritten.

Staging and Production are separate GitHub Environments with separate secrets. Pull-request jobs cannot reference either environment. The SSH transport writes runtime and migration payloads through standard input into mode `0600` files; secret values are not command arguments or logs. Host keys are pinned by `DEPLOY_KNOWN_HOSTS`; dynamic `ssh-keyscan` trust is prohibited.

Runtime payloads must contain matching `NODE_ENV` and `SCO_DEPLOY_ENVIRONMENT` markers plus `SCO_DOCUMENT_STORAGE=s3`. Migration payloads require the same environment marker. A mismatched or incomplete environment fails closed before SSH deployment.

## Docker Host Rollout

The provider-neutral contract requires Linux, Bash, Docker, and curl. The deploy user needs narrowly administered Docker access and write access only to `DEPLOY_PATH`. The host must provide private database/object-storage connectivity and external TLS/reverse-proxy routing; this Batch does not configure DNS, load balancers, hosts, or live services.

The host script pulls all exact digests before mutation, runs migrations, preserves current containers under rollback names, starts the new containers, and checks API liveness/readiness plus both web roots. A failed application check removes newly started containers and restores preserved containers. Successful checks remove rollback containers but retain immutable images.

Application rollback is safe only while migrations remain backward compatible. Migration rollback is never automatic. If readiness fails after a non-compatible migration, operators must stop and use a reviewed forward fix rather than assume the previous application can safely run.

## Adversarial Boundaries

- Untrusted PR code has read-only repository permission and no environment or package-write secrets.
- Release is manual and accepts only a full SHA on `main` with a successful `push` CI run.
- Only the publish job can write GHCR packages.
- Production secrets are scoped to the protected `production` environment.
- Production receives staging-tested digests; it cannot rebuild artifacts.
- Deployment input values, image digest format, SSH host identity, ports, paths, and environment markers are validated.
- Migration failure blocks rollout; readiness failure triggers application rollback where schema compatibility permits.
- Release concurrency is serialized to avoid overlapping host deployments.

Redis, queues, search engines, microservices, Kubernetes, load balancers, and autoscaling remain outside this Batch.
