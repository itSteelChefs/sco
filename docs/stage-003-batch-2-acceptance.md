# STAGE 003 — Batch 2 Acceptance Matrix

Baseline: `9bfed62`  
Scope: Company Partnerships and Qualification only.

| Criterion | Status | Evidence |
|---|---|---|
| PRE_TENANT qualification records do not create tenant, partnership, membership, or portal entitlement | PASS | `qualification_applications` has no company/membership entitlement; runtime boundary test |
| Qualification approval/rejection is explicit | PASS | QualificationService decision workflow and migration status model |
| Buyer and Supplier partnerships are independent | PASS | Unique `(company_id,type)` and direct isolation test |
| Same Company can hold both partnership types | PASS | Independent type model; no company duplication |
| Activation is explicit and separate from qualification | PASS | Partnerships begin `UNDER_REVIEW`; activation endpoint sets ACTIVE explicitly |
| Membership alone does not imply commercial eligibility | PASS | Membership eligibility regression test and service contract |
| Active partnership plus RBAC permission is required | PASS | `MembershipEligibilityService` query contract |
| Company isolation and no UUID bypass | PASS | RLS policy and direct runtime test |
| PRE_TENANT data requires SCO Internal authorization | PASS | RLS denies without `app.sco_internal`; allows only scoped internal transaction |
| Audit covers qualification and partnership events | PASS | Qualification/partnership services call AuditService |
| No confidential data or secrets in audit metadata | PASS | Existing Stage 002 safe metadata filtering preserved |
| No Batch 3 feature implemented | PASS | Scoped files and diff review |
| Migration is minimal and dependency-free | PASS | `0005_qualification_partnerships`; no package changes |
| Stage 002 and Batch 1 regressions pass | PASS | 11 database tests, 16 API integration tests, 3 contract tests |

Result: **READY FOR OWNER REVIEW**. Batch 3 has not started.
