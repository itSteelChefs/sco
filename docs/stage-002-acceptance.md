# STAGE 002 Acceptance Matrix

Status is evidence-based for the current local repository. `PASS` means the criterion has executable evidence; `NEEDS DECISION` means the foundation is present but a planned follow-on or owner decision remains. No Stage 003 work is included.

| # | Criterion | Status | Evidence |
|---:|---|---|---|
| 1 | Workspace and reproducible local PostgreSQL | PASS | `package.json`, Compose, migrations |
| 2 | Prisma schema and versioned migrations | PASS | `apps/api/prisma` |
| 3 | User/Company/CompanyMembership model | PASS | migration 0001, identity services |
| 4 | Multiple memberships and statuses | PASS | API integration tests |
| 5 | Authentication and disabled-session rejection | PASS | 16 API integration tests |
| 6 | Server-derived Tenant Context | PASS | TenantGuard and transaction service |
| 7 | PostgreSQL ENABLE/FORCE RLS | PASS | direct RLS suite (8 tests) |
| 8 | Runtime role least privilege | PASS | role metadata and grant tests |
| 9 | Pool/context leak prevention | PASS | transaction-local context tests |
| 10 | Membership-scoped RBAC | PASS | partner/internal permission tests |
| 11 | Partner/Internal boundary | PASS | separate controllers and portal shells |
| 12 | Audit tenant/system/pre-tenant scopes | PASS | AuditService integration test |
| 13 | Audit metadata secret filtering | PASS | audit test asserts secrets absent |
| 14 | Private document storage abstraction | PASS | StorageProvider and development adapter |
| 15 | Cross-tenant document authorization | PASS | DocumentsService integration test |
| 16 | API versioning and correlation ID | PASS | `/api/v1`, middleware test path |
| 17 | Validation envelope | PASS | invalid login integration assertion |
| 18 | OpenAPI endpoint | PASS | `/api/v1/openapi.json` test |
| 19 | Pagination contract | PASS | Reusable validated `PaginationDto`; internal companies endpoint enforces page 1.. and pageSize 1..100; integration tests cover valid and invalid bounds |
| 20 | Partner Portal build and boundary shell | PASS | Next build and portal test |
| 21 | Operations Portal build and boundary shell | PASS | Next build and portal test |
| 22 | Seed/reset workflow | PASS | Official `prisma db seed` script is idempotent, development/test-only, uses no committed secrets, and is independent of test fixtures |
| 23 | Backup/recovery and production deployment | DEFERRED — OWNER APPROVED DEFERMENT | Future requirements are documented in `docs/runbooks/backup-recovery.md`; production execution is explicitly not approved in Stage 002 |
| 24 | Security/dependency scan | PASS | `pnpm audit --audit-level=high`: 0 high, 5 moderate |
| 25 | Scope exclusions and no Production impact | PASS | docs/runbook and unchanged external services |

Final result: **READY FOR OWNER APPROVAL** for the executable Stage 002 scope. Item 23 remains explicitly deferred by owner decision; no production deployment was performed. Stage 003 is not started.
