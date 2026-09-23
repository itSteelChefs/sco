# STAGE 002 Security Log

## 2026-09-22 — Development-secret history remediation

- Development-only credentials appeared in the initial local Git history.
- Verified that this repository has no configured Git remote and no commit was pushed.
- Removed the local history and recreated it from the current clean working-tree snapshot.
- Replaced the local development credentials in the ignored `.env` file with newly generated values.
- The migration and Docker Compose configuration receive credentials only from environment variables; neither contains a password.
- Verified the new tracked files and reachable Git history do not contain the retired credential values.

## 2026-09-22 — Security Gate environment controls

- Local `.env` is ignored by Git and regenerated with fresh development-only credentials at file mode `0600`.
- Prisma migrations create no database login password. The local runtime role is provisioned from `RUNTIME_DATABASE_PASSWORD` at development setup time.
- PostgreSQL runtime access was reduced to the grants exercised by the Security Gate; mutation grants on `User`, `Company`, and `CompanyMembership` are revoked.
- The clean local repository still has no configured remote. No production service, DNS record, Nginx configuration, Odoo instance, meeting service, or firewall setting was changed.

## 2026-09-23 — Batch 6 and portal verification

- RBAC, tenant/system/pre-tenant Audit events, private document authorization, versioned API foundation, and minimal Partner/Operations portal shells were implemented.
- Next.js/React were installed with `--ignore-scripts`; only direct TypeScript type dependencies were added. Both portals build successfully.
- `pnpm audit --audit-level=high` reports zero High vulnerabilities after constrained `postcss` and `deepmerge-ts` overrides; five Moderate advisories remain documented for owner review.

## 2026-09-22 — Tenant Isolation Security Gate approval

- **SECURITY GATE — OWNER APPROVED**.
- PostgreSQL RLS, server-derived tenant context, active-membership validation, multi-company isolation, and the supporting API/direct-database evidence are accepted as complete within Stage 002.
- Subsequent Stage 002 tables that carry company ownership require explicit RLS review before acceptance.

## 2026-09-23 — Remaining Stage 002 owner decisions

- Added a reusable, bounded Pagination DTO and integration coverage for the internal list endpoint.
- Added an idempotent Prisma development/test seed. It is disabled when `NODE_ENV=production`, uses no committed credentials, and is independent of test fixtures.
- Documented future backup/recovery and production deployment requirements without executing deployment or changing production services.
