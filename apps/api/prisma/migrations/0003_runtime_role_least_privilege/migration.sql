-- The Security Gate API only reads system identity/company data and reads
-- memberships while resolving tenant context. Keep mutation grants absent
-- until a later, permission-protected internal workflow needs them.
REVOKE INSERT, UPDATE, DELETE ON "User", "Company", "CompanyMembership" FROM sco_runtime;
