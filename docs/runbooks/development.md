# SCO development runbook

1. Generate `.env` with `node scripts/create-development-env.mjs --force`.
2. Install with `corepack pnpm install --ignore-scripts`.
3. Start local PostgreSQL with `corepack pnpm db:up`.
4. Apply migrations with `corepack pnpm db:migrate`.
5. Run API database and integration tests.
6. Build both portals.

Only the local Compose PostgreSQL service is touched. Do not point these commands at a production database or service. `sco_runtime` is provisioned from environment variables by `apps/api/scripts/provision-runtime-role.mjs`; credentials are never printed.
