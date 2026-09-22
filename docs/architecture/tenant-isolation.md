# Tenant Isolation Security Boundary

## Tenant-scoped tables

`CompanyMembership` and `tenant_probes` are tenant-scoped because each row has a required company identifier. Both have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` in migration `0001_foundation`.

The runtime policy compares the row company identifier with `current_setting('app.tenant_id', true)`. A missing setting resolves to NULL, so `USING` and `WITH CHECK` deny access. The application sets this value transaction-locally only after server-side validation of an active CompanyMembership.

`CompanyMembership` has one narrow bootstrap read policy in migration `0002_security_gate_identity`: within a transaction the server sets `app.actor_id` from an already authenticated session, and the runtime role may read only rows whose `userId` equals that actor. This lets the server validate memberships without trusting a client company identifier. It does not set `app.tenant_id`, and it grants no access to tenant business rows.

## System-scoped tables

`User`, `Session`, and `Company` are system-scoped identity/session/directory data, so they do not receive RLS. `Session` stores only a SHA-256 hash of an opaque random session identifier; it is revoked and rechecked with the user's current status on every protected request. These tables are accessed only through server-side identity services and explicit partner/internal DTOs. A future tenant-owned table must have `company_id`, RLS, FORCE RLS, a runtime grant, and direct PostgreSQL tests before it is exposed.

## Runtime database role

`sco_runtime` is created as `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`. It has only CONNECT, schema USAGE, read access to the system identity/company tables, session CRUD needed by authentication, and the currently required grants on tenant-scoped test data. It owns no table and has no schema creation grant. Migration `0003_runtime_role_least_privilege` explicitly revokes mutation access to `User`, `Company`, and `CompanyMembership` until a later permission-protected workflow needs it. It cannot change table policies, disable RLS, or bypass it.

## Lifecycle

1. Authenticate a user from an opaque, hashed, unrevoked session and reject a disabled user.
2. Begin a membership-resolution transaction and run `set_config('app.actor_id', authenticatedUserId, true)`.
3. Read only the actor's memberships, resolve the sole ACTIVE membership or validate the explicitly selected header value. A suspended, revoked, foreign, or ambiguous selection is denied here.
4. Begin a tenant transaction only after that validation, run `set_config('app.tenant_id', tenantId, true)`, and attach the validated context to the request.
5. Run tenant-scoped queries through the runtime role.
6. Commit or roll back. Both settings are transaction-local and end before the pooled connection is released.

The direct PostgreSQL tests connect as `sco_runtime`, not as the database owner or a superuser. They prove cross-tenant SELECT, UPDATE, DELETE, INSERT, missing-context access, context reuse, `SET row_security = off` bypass attempts, and the role's lack of `BYPASSRLS` and table ownership. The API integration test proves the full request path, including disabled/suspended/revoked users, multi-membership selection, a hostile company header, and no tenant transaction for rejected requests.
