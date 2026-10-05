# Partner Admission and Agreement Evidence Foundation

Status: implementation candidate; not yet Owner accepted.

Migration `0102_partner_admission_agreement_foundation` adds company-bound
Partner qualification, explicit Partnership decisions, and versioned agreement
evidence. It is a forward migration and does not change the accepted migration
history. It has only been deployed by the disposable test-database harness
during validation; it has not been applied to the development or production
database.

## Lifecycle and data

- A qualification may remain unbound for the existing pre-tenant flow. The
  company-bound creation gateway accepts only an active Partner Company.
- A Buyer Partnership can be created only for an active Partner Company with
  an approved, company-bound qualification. Qualification, Partnership
  approval, and Partnership activation remain distinct transitions.
- Buyer Partnership approval requires current Binding Confidentiality
  acceptance. Activation rechecks the qualification and agreement evidence
  and requires an active Partner membership with `partner.portal.read`.
- Qualification, Partnership, agreement-policy, and agreement-acceptance
  history is recorded as append-only events. Mutable policy configuration is
  versioned; published agreement content and its SHA-256 are immutable.
- Each acceptance binds the Company, actor, active membership, policy version,
  exact content hash, required permission basis, purpose, idempotency key, and
  correlation ID. A retry with the same key and payload returns the original
  acceptance; reusing the key for a different payload is rejected.
- `BINDING_CONFIDENTIALITY` cannot be configured as optional. Agreement text,
  effective date, acceptance permission, reacceptance behavior, suspension
  and termination effects, and retention classification are configured
  explicitly; no legal text or retention policy is seeded by this migration.
  The exact configured text is stored in the policy-version table.

## API surface

Partner tenant routes:

- `GET /api/v1/partner/admission/status`
- `GET /api/v1/partner/admission/agreements`
- `POST /api/v1/partner/admission/agreements/accept`

SCO-internal routes under `/api/v1/internal/network` manage qualifications,
Partnership decisions, and agreement-policy create/publish/suspend/terminate
operations. Existing procurement document extraction is additionally guarded
by a server-side check for eligible Partner access.

## Security boundaries

- New evidence tables use RLS and `FORCE ROW LEVEL SECURITY`; runtime and
  internal executor roles have no direct access to the evidence tables.
- `sco_partner_admission_gateway_owner` is a non-login, non-superuser role
  without `BYPASSRLS`, database/role creation, or inherited privileges.
  Sensitive gateways use `search_path = pg_catalog, public`, and `PUBLIC`
  execute is revoked.
- Runtime receives only the Partner-scoped admission/agreement projections,
  acceptance gateway, and current-actor procurement eligibility projection.
  Internal mutation gateways remain scope-specific. Legacy qualification,
  Partnership activation, and procurement-need gateway ownership and grants
  preserve their existing `sco_internal_gateway_owner` / executor boundary.
- Procurement-need creation additionally checks active membership, Buyer
  Partnership, `partner.portal.read`, and current required agreement evidence.
  It does not introduce a generic Partner service entitlement.
- Admission events and acceptance decisions emit purpose-tagged audit records.
  Agreement text is returned only through the company-scoped agreement
  projection; no storage locator is exposed.

## Validation evidence

The disposable migration-from-zero workflow applied migrations 0001–0102.
One focused integration batch passed 52 tests across Partner
admission, qualification/Partnership, SR-01/SR-02 gateway security, procurement
documents, and Stage 007 CPF-03. A later combined retry encountered connection
refusals on the disposable test port and overlapping global agreement-policy
fixtures, so that retry is inconclusive. The Stage 007 CPF-03 test passed
separately (6 tests) afterward. API TypeScript build, Prisma validation,
migration-integrity check, sensitive-file gate, and `git diff --check` passed.
No migration was applied to a persistent database.
