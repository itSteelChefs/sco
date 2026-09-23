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
| 19 | Pagination contract | NEEDS DECISION | Internal list shape exists; shared DTO enforcement remains |
| 20 | Partner Portal build and boundary shell | PASS | Next build and portal test |
| 21 | Operations Portal build and boundary shell | PASS | Next build and portal test |
| 22 | Seed/reset workflow | NEEDS DECISION | Fixtures are resettable; formal Prisma seed command remains |
| 23 | Backup/recovery and production deployment | NEEDS DECISION | Explicitly outside local Stage 002 execution |
| 24 | Security/dependency scan | PASS | `pnpm audit --audit-level=high`: 0 high, 5 moderate |
| 25 | Scope exclusions and no Production impact | PASS | docs/runbook and unchanged external services |

Final result: **NOT READY FOR OWNER APPROVAL** until items 19, 22, and 23 receive the planned completion/owner decision. Stage 003 is not started.
