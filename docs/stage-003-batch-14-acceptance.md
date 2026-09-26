# Stage 003 Batch 14 Acceptance

Status: CLOSED / READY FOR OWNER ACCEPTANCE

Batch 14 is the Stage 003 development and staging-like readiness closure. It adds no product capability, commercial rule, authorization rule, migration, or Stage 004 scope.

## Stage Closure

Stage 003 Batches 1 through 13 remain closed. Batch 14 verifies that their current filesystem lineage, seed, access controls, application initialization, and PostgreSQL regression suite can run from a new local development/staging-like database without copying hidden state from `sco_dev`.

The accepted Stage 003 architecture preserves Company and independent Buyer and Supplier Partnerships, RBAC-derived authority, Product Identity and Unit grain, root quantity lineage, separate buy-side and sell-side commercial facts, confidential Purchase Sources and purchase cost, immutable commercial and audit history, purpose-built internal gateways, and RLS/FORCE RLS protections.

## Fresh Environment Evidence

- Baseline: `d943f4190f1bb7c6699919c541198c6fecaa7edd` on `main`.
- A new local temporary database was created from zero repeatedly during Batch 14. No data, ledger rows, or objects were copied from `sco_dev`.
- Prisma validation, deployment of migrations `0001` through `0081`, migration status, and repository seed passed on the temporary database.
- The fresh roles `sco_runtime` and `sco_internal_executor` were login roles without `BYPASSRLS`. The fresh schema contained 122 public tables with both RLS and FORCE RLS enabled.
- API initialization against the clean database succeeded on loopback and the application was immediately closed. No public service was exposed.

## Security and Regression Evidence

- Fresh security gate: 1 file / 18 tests passed.
- Fresh PostgreSQL RLS and Batch 13 adversarial suites: 2 files / 11 tests passed.
- Clean-database portability repairs made `buying-power-foundation` and `supplier-payment-schedule-scoped-read` own the approved-cost and payment schedule fixtures they require. No production source, migration, business behavior, or authorization behavior changed.
- Focused fixture verification: Buying Power 21 tests passed; payment scoped read 6 tests passed.
- Full repository-standard PostgreSQL regression on a separate clean migrated and seeded database: 48 files / 338 tests passed, plus the environment test.

The security gate is intentionally executed first in its own clean database. It resets global identity fixtures; the full domain regression creates evidence records that make post-regression gate cleanup inappropriate. This is test ordering, not a schema or authorization dependency.

## Migration Integrity

- Filesystem migrations: 81, each with `migration.sql`.
- Latest migration: `0081_supplier_future_demand_framework_tier_ordinality_fix`.
- `0077` SHA-256: `83e3222ca4bdefe8af420112fa354cad40ffd248ac0e4ddb8f899edd1576bf3e`.
- `0078` SHA-256: `8d699d2eb21f288aafbbc2b0730dd61bdab4249809ea6761ad0524a744aa6c09`.
- `0079` SHA-256: `2e241a65aaf6af29997cd134d0adb99ef8a55c3c4736534b79262235c884e266`.
- `0080` SHA-256: `7775c2669300facdd00a9d64ea6927f2657e66d193ae5cdb4615afa89e40c052`.
- `0081` SHA-256: `daddd0738e60acad19f0769107feb85df082155c079b3f5b786b78feb2592d10`.
- No `0082` exists.

Development retains four accepted historical DB-only migration ledger entries. They are not reconstructed, copied into a fresh environment, or used as current filesystem authority.

## Intentional Exclusions

Batch 14 does not define or begin Stage 004. It does not add warehouse, inventory, accounting, AP, treasury, payment execution, production deployment, Supplier Portal, automatic sourcing, automatic supplier selection, automatic negotiation, automatic pricing, Partner cross-tenant Buying Power, or AI forecasting.

Production was not accessed or modified. No migration was applied outside local temporary verification databases. Temporary databases are removed after final verification.
