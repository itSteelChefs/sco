CREATE TABLE "Session" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "idleExpiresAt" TIMESTAMPTZ NOT NULL,
  "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "revokedAt" TIMESTAMPTZ
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- Identity and session records are system-scoped. Tenant data remains protected
-- by the RLS policies defined in the foundation migration.
GRANT SELECT, INSERT, UPDATE ON "User", "Company", "Session" TO sco_runtime;

-- Membership selection is the only pre-tenant read. The server sets actor_id
-- from an authenticated session in the same transaction, then validates an
-- ACTIVE membership before it ever sets app.tenant_id.
CREATE POLICY company_membership_read_own ON "CompanyMembership"
  FOR SELECT TO sco_runtime
  USING ("userId" = NULLIF(current_setting('app.actor_id', true), '')::uuid);
