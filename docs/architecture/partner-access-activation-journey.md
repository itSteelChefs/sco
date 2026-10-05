# H2 — Partner Access Activation & Journey Foundation

Status: candidate. Non-visual, server-side only. The journey itself needs no schema change; migration `0103` exists solely for the
security hardening in the last section (SH-01 / SH-02).

## Decision: activation is derived, not a new durable concept

"Access Activation" is already a durable, audited business event in 0102: the SCO-internal transition
`internal_partnership_activate` (`company_partnerships.status = 'ACTIVE'`, a `company_partnership_events` row and a
`partnership.activated` audit event). It is only possible when the qualification is APPROVED, the required agreements
are satisfied and the company has at least one portal member (`PARTNERSHIP_ONBOARDING_INCOMPLETE` otherwise).
Nothing else in the repository needs durable state, so H2 adds **no table, status column or flag**. The journey is a
per-request derived projection; it is never stored, cached or accepted from a client.

## Facts, sources and dimensions

| Business fact | Server-authoritative source | Dimension |
| --- | --- | --- |
| Approved Partner | `company_partnerships.status = 'APPROVED'` (BUYER_PARTNERSHIP) | Partner lifecycle |
| Active Partner | `company_partnerships.status = 'ACTIVE'` | Partner lifecycle |
| Suspended / Revoked / Rejected | same column; Class D denies on the next operation | Partner lifecycle |
| Binding Confidentiality satisfied | `partner_required_agreements_satisfied(company)` | Agreement / trust |
| Qualification state | `qualification_applications` via `partner_admission_status()` | Admission |
| Organizational eligibility | `CompanyMembership` ACTIVE in an ACTIVE company | Membership |
| Actor may do X | RBAC permission via `PermissionsService` | Permission |
| Class D Partner eligibility | `partner_procurement_access_allowed_for_current_actor()` | Resource Authorization (H1) |
| Why / for what | registry-owned purpose | Purpose |
| Data owner | `app.tenant_id` / RLS | Tenant scope |

Entitlement is not required by any H2 or Verify route; it applies only to operations tied to an enabled/paid service.
Future seam: a commercial entitlement contract for Verify would be added as an explicit, separate layer in that
operation's profile, never as a generic Partner requirement.

## Classification

| Class | Experience | Gate |
| --- | --- | --- |
| B | Onboarding / agreements (`/partner/admission/*`) | `partner.admission.read` / `partner.agreement.accept` |
| C | Basic Partner shell (`/partner/me`, `/partner/journey`, workspace) | membership + `partner.portal.read` (journey: portal **or** admission read) |
| D | Verify result, procurement documents (H1 routes) | operation permission + Active Partner + Binding Confidentiality + purpose |

The shell is intentionally **not** gated on Active status, so onboarding and suspended Partners keep remediation and
support access. Workspace/shell access never implies Verify, document or commitment access.

## The journey projection

`GET /api/v1/partner/journey` (guarded by `ResourceAuthorizationGuard`, operation `partner_journey.read`, purpose
AUTHORIZATION, PARTNER companies only) returns:

- `company` / `actor`: the caller's own tenant context.
- `operational.procurementAccess`: `AVAILABLE` or `RESTRICTED` (with a coarse safe `reason`), taken from the Class D gate.
  This is deliberately separate from the relationship status: if a required agreement later needs reacceptance,
  `company_partnerships.status` stays `ACTIVE` (no commercial state is mutated), the relationship stage stays `ACTIVE`,
  and procurement access is `RESTRICTED` (`AGREEMENT_REQUIRED`) with Class D denied until the current version is
  accepted. No second durable lifecycle state exists.
- `relationship` (only with `partner.admission.read`, otherwise `null`): `stage` derived by `deriveStage` from
  qualification, partnership and agreement satisfaction (`REGISTRATION`, `QUALIFICATION`, `AGREEMENT`, `APPROVAL`,
  `ONBOARDING`, `ACTIVE`, `SUSPENDED`, `REVOKED`, `REJECTED`), `agreementsSatisfied`, and `pendingAgreements`
  (type, version, status, whether the Partner can resolve it by accepting).
- `nextAction`: `ACCEPT_AGREEMENTS`, `AWAIT_SCO_REVIEW`, `CONTACT_SCO` or `NONE`, with the owner and whether the actor
  is permitted.
- `experiences` (shell, onboarding, procurement) and `capabilities` (agreement acceptance, Verify result read,
  procurement document extraction) with `enterable`/`available` and a coarse safe `reason`
  (`PERMISSION_REQUIRED`, `RELATIONSHIP_NOT_ACTIVE`, `AGREEMENT_REQUIRED`, `NOT_AVAILABLE`).

Capability availability reuses the H1 registry through `ResourceAuthorizationService.decideAvailability`, so the
projection cannot drift from enforcement. It returns a distinct, non-enforcing `AuthorizationAvailability`
(`kind: 'ADVISORY_AVAILABILITY'`, `available`, no `allowed` field) that is not assignable to an enforcing
`AuthorizationDecision`. Its only call sites are the two projection lookups in `PartnerJourneyService`. It is advisory
only: every sensitive route re-evaluates all dimensions on each request, and no client flag is authority.

Permission removal is reflected on the next request: removing `partner.portal.read` makes procurement access
`RESTRICTED` (`PERMISSION_REQUIRED`) while the relationship stays `ACTIVE`; removing only `partner_verify.read` keeps
procurement access `AVAILABLE` and closes just the Verify capability and route.

Not disclosed: agreement content or hashes, permission codes, policy internals, supplier or commercial data, other
tenants, storage details.

## H1 extension

Registry invariant (tested): no operation with `partnerClassD === true` may use an any-of permission; the only any-of
operation is the Class C journey. H1 gained one resource-less operation profile (`partner_journey.read`, kind `COMPANY`, no route resource id), an
any-of permission form, and the read-only `decideAvailability`. Existing operation profiles and layer order are
unchanged. Audit semantics are unchanged: one final-outcome event per request.

## Not changed

Service Access (an SCO employee never becomes a Partner member), Controlled Disclosure, document security, the
Workspace domain, migrations 0001–0102, RLS and grants.

## Evidence

- `test/integration/partner-journey-http.integration.test.ts` — real HTTP lifecycle (registration → active →
  suspended → revoked), agreement no longer satisfying, membership/permission/tenant failures, A↔B substitution, audit
  truthfulness, non-disclosure.
- `test/database/resource-authorization-composition.integration.test.ts` — H1 plus the H2 extension.
- Existing Verify, procurement-document and Workspace suites remain the regression evidence for those boundaries.

## Registration

Partner registration remains SCO-assisted / controlled onboarding in H2 (SCO creates the qualification and
partnership). No public self-service registration exists or was added.

## Security hardening (migration 0103)

Migration `0103` is limited to RBAC write revocation and product-candidate tenant integrity.

| Finding | Root cause | Authoritative fix |
| --- | --- | --- |
| SH-02 runtime RBAC self-grant | `sco_runtime` held INSERT on `Role`, `RolePermission`, `MembershipRole` under a tenant-only ALL policy, so any runtime SQL path could mint a role with any permission and attach it to its own membership | Write privileges revoked from `sco_runtime` and PUBLIC (nothing in the application writes these tables; provisioning is an owner/SCO operation). Tenant policies replaced by SELECT-only ones so a stray future GRANT still opens no write path. The migration asserts the absence of write privileges. |
| SH-01A `procurement_needs.product_candidate_id` | FK checks bypass RLS and `internal_procurement_need_create` validated only the project | `BEFORE INSERT OR UPDATE` trigger requires `candidate.company_id = need.company_id`, for every writer. |
| SH-01B `procurement_document_lines.product_candidate_id` | same unbound reference, writable by `sco_runtime` under a company-only RLS check | `BEFORE INSERT OR UPDATE OF product_candidate_id, company_id, document_id` trigger requires the candidate, the line's own `company_id` (the RLS tenant key) and the parent document to agree. A line therefore cannot straddle companies while carrying a candidate. |

Both validators are SECURITY DEFINER with a fixed `search_path`, owned by the single NOLOGIN, non-superuser,
NOBYPASSRLS helper `sco_candidate_integrity_owner`, which is read-only: column-level SELECT on
`product_candidates(id, company_id)` and `procurement_documents(id, company_id)` plus matching SELECT-only policies, no
RBAC access. Foreign, company-less (SCO-internal) and non-existent candidates fail with one identical error (no
existence oracle). Historical rows are not retro-validated.

### Product Candidate reference audit

| Referencing column | Nullable | Tenant-owned | Runtime-writable | Internal writer | Same-company binding | Exploitable |
| --- | --- | --- | --- | --- | --- | --- |
| `procurement_needs.product_candidate_id` | yes | yes | no (SELECT only) | gateway functions | trigger (SH-01A) | no |
| `procurement_document_lines.product_candidate_id` | yes | yes | yes | no | trigger (SH-01B) | no |
| `product_match_assessments.candidate_id` | no | via candidate | yes | internal gateway | RLS `WITH CHECK` on candidate company | no |
| `product_candidate_history.candidate_id` | no | via candidate | yes | internal gateway | RLS `WITH CHECK` on candidate company | no |

No other column references candidates (catalogue-verified by test).

### Product Candidate company re-home: owner-only administrative invariant

`product_candidates.company_id` can be changed only by the database owner. `sco_runtime` holds UPDATE but RLS
`WITH CHECK` pins rows to the tenant (no move to another company or NULL; stealing another tenant's row affects zero
rows); `sco_internal_executor` has no privilege; no gateway function writes `company_id`
(`internal_candidate_transition` only changes status and review fields). No runtime architecture was added; the
invariant is proven by `h2-security-hardening` and must be preserved if candidate writers are ever added.

Evidence: `test/database/h2-security-hardening.integration.test.ts` (SH-01A/SH-01B adversarial matrices, reference
audit, re-home, SH-02, helper least privilege) and `test/database/partner-reacceptance-restriction.integration.test.ts`.
