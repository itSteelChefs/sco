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
