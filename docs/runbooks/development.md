# SCO development runbook

1. Generate `.env` with `node scripts/create-development-env.mjs --force`.
2. Install with `corepack pnpm install --ignore-scripts`.
3. Start local PostgreSQL with `corepack pnpm db:up`.
4. Apply migrations with `corepack pnpm db:migrate`.
5. Run API database and integration tests.
6. Build both portals.

Only the local Compose PostgreSQL service is touched. Do not point these commands at a production database or service. `sco_runtime` is provisioned from environment variables by `apps/api/scripts/provision-runtime-role.mjs`; credentials are never printed.

## Stage 003 fresh-environment readiness

Use an isolated temporary PostgreSQL database. Do not copy `sco_dev`, restore a backup, add legacy objects, or alter `_prisma_migrations`. The authoritative fresh lineage is migrations `0001` through `0081` followed by the repository seed:

1. Load the local non-production `.env` without printing it, create an empty temporary database, and set `DATABASE_URL`, `RUNTIME_DATABASE_URL`, and `SCO_INTERNAL_DATABASE_URL` to that database for the command being run.
2. Run `corepack pnpm --filter @sco/api exec prisma validate --schema prisma/schema.prisma`.
3. Run `corepack pnpm --filter @sco/api exec prisma migrate deploy --schema prisma/schema.prisma`.
4. Run `corepack pnpm --filter @sco/api exec prisma migrate status --schema prisma/schema.prisma`.
5. Run `corepack pnpm --filter @sco/api prisma db seed`.
6. Run the security gate in that clean database: `corepack pnpm --filter @sco/api vitest run test/integration/security-gate.integration.test.ts`.
7. Run the database security checks in that clean database: `corepack pnpm --filter @sco/api vitest run test/database/postgres-rls.integration.test.ts test/database/stage-003-adversarial-security.integration.test.ts`.
8. For the full regression, create a second clean database, migrate and seed it, then run `corepack pnpm --filter @sco/api test`.
9. Drop every temporary database after verification.

The security gate owns global identity fixtures and must run before a full regression in its own clean database. A full regression creates domain evidence that intentionally prevents the gate's fixture cleanup from deleting shared identity/document rows afterward.

### Environment and role expectations

- Required application configuration: `DATABASE_URL` and `SESSION_SECRET`.
- Runtime database configuration: `RUNTIME_DATABASE_URL` connects as `sco_runtime`.
- Internal database configuration: `SCO_INTERNAL_DATABASE_URL` connects as `sco_internal_executor`.
- Development-only seed input: `SCO_SEED_PASSWORD` is optional; an ephemeral seed password is generated when it is absent. Seeding is refused when `NODE_ENV=production`.
- Optional listener configuration: `PORT` defaults to `3101`; the API binds to `127.0.0.1`.
- The current configuration has no storage-specific environment key. Development document data uses the repository's local development storage layout.

Migrations provision the runtime and internal roles. Both must be login roles without `BYPASSRLS`; do not grant table privileges or repair role state manually. Application startup is safe to probe locally against a temporary database by initializing and immediately closing the API. Do not expose it publicly.

## Migration and recovery boundaries

Applied migration files are immutable. Stage 003 has 81 filesystem migrations and no `0082`. Development's historical four DB-only ledger entries are accepted legacy divergence; never recreate them, edit the ledger, or treat them as fresh lineage. Use the backup/recovery requirements in `backup-recovery.md` for an isolated recovery drill. This runbook does not authorize production access, migration, deployment, rollback, or service exposure.
