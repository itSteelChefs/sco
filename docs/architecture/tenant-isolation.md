# Tenant Isolation Security Boundary

## Tenant-scoped tables

`CompanyMembership` and `tenant_probes` are tenant-scoped because each row has a required company identifier. Both have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` in migration `0001_foundation`.

The runtime policy compares the row company identifier with `current_setting('app.tenant_id', true)`. A missing setting resolves to NULL, so `USING` and `WITH CHECK` deny access. The application sets this value transaction-locally only after server-side validation of an active CompanyMembership.

## System-scoped tables

`User` is global identity data and `Company` is the shared company directory; neither has intrinsic tenant ownership, so neither receives RLS. They must be accessed only through server-side authorization services and explicit partner/internal DTOs. A future tenant-owned table must have `company_id`, RLS, FORCE RLS, a runtime grant, and direct PostgreSQL tests before it is exposed.

## Runtime database role

`sco_runtime` is created as `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`. It has only CONNECT, schema USAGE, and CRUD grants on tenant-scoped tables; it owns no table and has no schema creation grant. It cannot change table policies, disable RLS, or bypass it.

## Lifecycle

1. Authenticate a user.
2. Resolve an ACTIVE CompanyMembership server-side.
3. Begin a transaction.
4. Run `set_config('app.tenant_id', tenantId, true)`.
5. Run tenant-scoped queries through the runtime role.
6. Commit or roll back. `SET LOCAL` scope ends with the transaction.

The direct PostgreSQL tests connect as `sco_runtime`, not as the database owner or a superuser. They prove cross-tenant SELECT, UPDATE, DELETE, INSERT, missing-context access, context reuse, and `SET row_security = off` bypass attempts are denied.
