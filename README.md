# SCO Platform

SCO platform for `sco.sa`. Stage 004 Batch 6-B defines a Staging Host & Edge Contract; Production deployment remains disabled.

Copy `.env.example` to `.env` or run `node scripts/create-development-env.mjs --force`, then run `corepack pnpm install --ignore-scripts`.

Development commands:

- `corepack pnpm db:up`
- `corepack pnpm db:migrate`
- `corepack pnpm --filter @sco/api test`
- `corepack pnpm --filter @sco/api test:integration`
- `corepack pnpm --filter @sco/partner-web build`
- `corepack pnpm --filter @sco/operations-web build`
- `corepack pnpm dev:api`, `corepack pnpm dev:partner`, `corepack pnpm dev:operations`

The API uses a non-owner `sco_runtime` role. Never commit `.env`; it is ignored and contains development-only values. The only current scope is `sco.sa`; legacy meeting systems are outside this repository.

Production runtime and delivery guidance:

- `docs/architecture/stage-004-batch-1-runtime-foundation.md`
- `docs/architecture/stage-004-batch-2-ci-cd-foundation.md`
- `docs/architecture/stage-004-batch-3-observability-foundation.md`
- `docs/architecture/stage-004-batch-4-recovery-foundation.md`
- `docs/architecture/stage-004-batch-5-performance.md`
- `docs/architecture/stage-004-batch-6-host-edge-contract.md`
- `docs/runbooks/release.md`
- `docs/runbooks/observability.md`
- `docs/runbooks/backup-recovery.md`
