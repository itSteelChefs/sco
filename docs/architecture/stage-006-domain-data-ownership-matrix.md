# Stage 006 — Batch 006-A — Domain & Data Ownership Matrix

## A. Scope and Authority

This document is the official engineering reference mapping **current** SCO domains and data assets to their real ownership and operational context.

Authorization scope: Stage 006, Batch 006-A, documentation/engineering-contract work only. This document creates no feature, no schema change, no migration, and no security remediation. It does not authorize or design Batch 006-B or later.

This document is descriptive, not prescriptive. Where current repository implementation and older architecture documents disagree, **current repository implementation wins** and the drift is recorded in section K and section L rather than silently reconciled.

Terminology from newer strategic vocabulary (service context, operator context) is used only as *classification labels*. No new data model is introduced to match that vocabulary.

## B. Engineering Baseline

| Item | Value |
| --- | --- |
| Repository | `/root/.ssh/sco` |
| Branch | `main` |
| HEAD | `43b3a6a05cd3911844b9f32321b08127f363f2f6` |
| Worktree state at authoring time | clean (no modified/untracked paths) |
| Migration range in scope | `0001` … `0086` |
| Date | 2026-10-01 |

All evidence below was read at this baseline. No database was queried, mutated, or started to produce this document.

## C. Ownership Terminology

"Owner" in this document means **engineering/data ownership or authoritative organizational context** — the organization whose context governs the record and determines who may legitimately reach it.

"Owner" explicitly does **not** mean any of the following, each of which is tracked separately in the repository:

| Concept | Column that usually carries it | Why it is not ownership |
| --- | --- | --- |
| Row creator | `created_by`, `uploader_user_id`, `submitted_by`, `initiated_by` | Identifies an acting human, not an owning organization |
| Acting user | `app.actor_id` GUC, `actor_user_id` | Request-scoped actor identity |
| Commercial counterparty | `supplier_company_id`, `partner_company_id` on internal records | Names the other side of a commercial fact; confers no access |
| Owning company / tenant | `company_id` + RLS policy on `app.tenant_id` | This *is* the authoritative tenant context |
| Storage owner | `documents.storage_key`, S3 bucket | Physical custody, not authority |
| Service operator | `sco_internal_executor`, gateway-owner roles | SCO operates the record; it is not the tenant |

Classification labels used in this document:

- **GLOBAL IDENTITY / PLATFORM PRIMITIVE** — platform-wide identity/directory data, not tenant-scoped.
- **COMPANY-OWNED CONTEXT** — authoritative `company_id` with tenant enforcement; company type not constrained by the record itself.
- **PARTNER-OWNED CONTEXT** — company-owned where current enforcement additionally requires `Company.type='PARTNER'`.
- **SUPPLIER-OWNED CONTEXT** — a record a Supplier organization authoritatively owns and can reach.
- **SCO-INTERNAL / OPERATOR CONTEXT** — SCO operates and controls the record; no tenant path exists.
- **PROJECT-CONTEXTUAL** — project context applies, secondary to company context.
- **SERVICE-CONTEXTUAL** — belongs to a distinct service boundary (currently only Verify).
- **CROSS-DOMAIN REFERENCE** — referenced by multiple domains without transferring ownership.
- **SHARED OPERATIONAL RECORD** — genuinely co-operated by more than one context.
- **NOT ENOUGH EVIDENCE** — repository does not settle the question.

Status vocabulary: IMPLEMENTED, CURRENTLY ENFORCED, CURRENTLY REPRESENTED, NOT IMPLEMENTED, NOT ENOUGH EVIDENCE.

## D. Current Ownership Model Summary

CURRENTLY ENFORCED facts:

1. `User` is a **global identity primitive**. It is not tenant-scoped and carries no RLS. Work created by a `User` is not therefore user-owned.
2. Organizational context is carried by `Company` + `CompanyMembership`. A user may hold memberships in multiple companies; a membership is uniquely identified by `(userId, companyId)`.
3. The authoritative tenant control mechanism is the pair `company_id` column + Row Level Security policy comparing it to `current_setting('app.tenant_id', true)`, with `FORCE ROW LEVEL SECURITY` and a non-`BYPASSRLS` runtime role.
4. There are **three distinct database access contexts**, not one:
   - tenant runtime (`sco_runtime`, requires `app.tenant_id`),
   - SCO internal operator (`sco_internal_executor` calling typed `internal_*` SECURITY DEFINER gateways owned by `sco_internal_gateway_owner`),
   - Verify system/partner-read gateways (`sco_verify_system_executor`, `sco_verify_gateway_owner`, `sco_verify_partner_read_owner`).
5. A large part of operational procurement has **no tenant path at all** and is SCO-INTERNAL / OPERATOR CONTEXT by construction (for example `rfqs` carries no `company_id` whatsoever).
6. Verify is an independent **service boundary** with its own tables, lifecycle triggers, immutability rules, gateway roles, and a separate partner-facing projection.
7. **No Supplier-facing HTTP surface exists.** Supplier organizations appear in the data model as commercial counterparties; they are not currently an access context.

NOT IMPLEMENTED (recorded so later stages do not assume otherwise): Service Access model for SCO staff into partner context; subscription/entitlement model; purpose-of-processing model outside Verify raw review; dynamic alias / identity masking; export, watermark, expiring-access, retention or disposal controls.

## E. Domain & Data Ownership Matrix

### E.0 Overview matrix

Compact view. Full 15-field entries follow in E.1 – E.11.

| # | Domain / Asset | Owner / Authoritative Context | Tenant Context | Project | Service |
| --- | --- | --- | --- | --- | --- |
| 1 | `User` | GLOBAL IDENTITY / PLATFORM PRIMITIVE | none | no | no |
| 2 | `Session` | GLOBAL IDENTITY / PLATFORM PRIMITIVE | none | no | no |
| 3 | `Company` | GLOBAL IDENTITY / PLATFORM PRIMITIVE (directory) | none | no | no |
| 4 | `CompanyMembership` | COMPANY-OWNED CONTEXT | `companyId` + RLS | no | no |
| 5 | `CompanyPartnership` | SCO-INTERNAL / OPERATOR CONTEXT (tenant-readable) | `company_id` + RLS | no | no |
| 6 | `qualification_applications` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 7 | `company_disciplines` | COMPANY-OWNED CONTEXT | `company_id` + RLS | no | no |
| 8 | `Role` | COMPANY-OWNED CONTEXT | `company_id` + RLS | no | no |
| 9 | `Permission` | GLOBAL IDENTITY / PLATFORM PRIMITIVE | none | no | no |
| 10 | `MembershipRole` | COMPANY-OWNED CONTEXT | `company_id` + RLS | no | no |
| 11 | `RolePermission` | COMPANY-OWNED CONTEXT | `company_id` + RLS | no | no |
| 12 | tenant context (`app.tenant_id`/`app.actor_id`) | PLATFORM PRIMITIVE (enforcement mechanism) | n/a | no | no |
| 13 | internal executor/gateway context | SCO-INTERNAL / OPERATOR CONTEXT | n/a | no | no |
| 14 | `projects` | COMPANY-OWNED CONTEXT + PROJECT-CONTEXTUAL | `company_id` + RLS | yes | no |
| 15 | `project_members` | COMPANY-OWNED CONTEXT + PROJECT-CONTEXTUAL | `company_id` + RLS | yes | no |
| 16 | `project_member_disciplines` | COMPANY-OWNED CONTEXT (via member) | inherited | yes | no |
| 17 | `documents` | COMPANY-OWNED CONTEXT, split by `access_scope` | `company_id` + RLS | no | no |
| 18 | `document_versions` | COMPANY-OWNED CONTEXT | `company_id` + RLS | no | no |
| 19 | `procurement_documents` | COMPANY-OWNED CONTEXT | `company_id` + RLS | no | no |
| 20 | `procurement_document_lines` | COMPANY-OWNED CONTEXT | `company_id` + RLS | no | no |
| 21 | `supplier_quote_documents` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 22 | `supplier_po_commercial_documents` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 23 | `audit_logs` | SHARED OPERATIONAL RECORD (scope-partitioned) | `company_id` when `scope='TENANT'` | no | no |
| 24 | `procurement_need_history` | COMPANY-OWNED CONTEXT (via need) | inherited | via need | no |
| 25 | `product_candidate_history` | CROSS-DOMAIN REFERENCE (candidate-scoped) | via candidate | no | no |
| 26 | `supplier_network_history` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 27 | `procurement_needs` | COMPANY-OWNED CONTEXT + PROJECT-CONTEXTUAL | `company_id` + RLS | yes | no |
| 28 | `procurement_plans` / `procurement_plan_items` | COMPANY-OWNED CONTEXT | `company_id` + RLS | indirect | no |
| 29 | `procurement_need_approvals` | COMPANY-OWNED CONTEXT | `company_id` + RLS | indirect | no |
| 30 | `procurement_cycles` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 31 | `procurement_executions` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 32 | `procurement_execution_items` | SHARED OPERATIONAL RECORD | `company_id` + RLS (read) | yes | no |
| 33 | `ready_allocation_events` | SHARED OPERATIONAL RECORD | `company_id` + RLS (read) | indirect | no |
| 34 | `procurement_cycle_exceptions` | SHARED OPERATIONAL RECORD | `company_id` + RLS (read) | indirect | no |
| 35 | `execution_change_requests` | SHARED OPERATIONAL RECORD | `company_id` + RLS (read) | indirect | no |
| 36 | `rfqs` | SCO-INTERNAL / OPERATOR CONTEXT | none (no `company_id`) | no | no |
| 37 | `rfq_items` | SCO-INTERNAL / OPERATOR CONTEXT (carries buyer reference) | `company_id` column, no tenant grant | yes | no |
| 38 | `rfq_recipients` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 39 | `supplier_quotes` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 40 | `supplier_quote_revisions` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 41 | `purchase_sources` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 42 | `supplier_qualifications` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 43 | `supplier_category_capabilities` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 44 | `approved_purchase_cost_snapshots` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 45 | `pricing_cases` / `pricing_revisions` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 46 | `partner_offers` | SCO-INTERNAL authored / PARTNER-addressed | `company_id` = partner | no | no |
| 47 | `partner_offer_revisions` | SCO-INTERNAL authored / PARTNER-addressed | via offer | no | no |
| 48 | `offer_internal_bindings` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 49 | `partner_purchase_orders` | PARTNER-OWNED CONTEXT | `partner_company_id` | no | no |
| 50 | `commercial_commitments` | SHARED OPERATIONAL RECORD | `partner_company_id` | no | no |
| 51 | `procurement_releases` | SCO-INTERNAL / OPERATOR CONTEXT | `partner_company_id` reference | no | no |
| 52 | `supplier_purchase_orders` | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 53 | supplier PO confirmation / delivery / tranche records | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 54 | partner delivery receipt/acceptance records | PARTNER-OWNED CONTEXT | partner company | no | no |
| 55 | payment / funding records | SCO-INTERNAL / OPERATOR CONTEXT (partner receipts partner-facing) | mixed | no | no |
| 56 | buying-power snapshots / views | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 57 | supplier future demand frameworks | SCO-INTERNAL / OPERATOR CONTEXT | none | no | no |
| 58 | warranty entitlement records | PARTNER-facing projection over internal facts | partner company | no | no |
| 59 | `verify_requests` | PARTNER-OWNED CONTEXT + SERVICE-CONTEXTUAL | `company_id` + RLS | no | Verify |
| 60 | `verify_quote_revisions` | PARTNER-OWNED CONTEXT + SERVICE-CONTEXTUAL | via request | no | Verify |
| 61 | `verify_quote_lines` (+ adjustments) | PARTNER-OWNED CONTEXT + SERVICE-CONTEXTUAL | via revision | no | Verify |
| 62 | `verify_runs` | SCO-INTERNAL / OPERATOR CONTEXT + SERVICE-CONTEXTUAL | via revision | no | Verify |
| 63 | `verify_evidence_bindings` | SCO-INTERNAL / OPERATOR CONTEXT + SERVICE-CONTEXTUAL | via run | no | Verify |
| 64 | `verify_run_line_scope` | SCO-INTERNAL / OPERATOR CONTEXT + SERVICE-CONTEXTUAL | via run | no | Verify |
| 65 | `verify_line_results` / `verify_line_result_evidence` | SCO-INTERNAL / OPERATOR CONTEXT + SERVICE-CONTEXTUAL | via run | no | Verify |
| 66 | `verify_results` | SCO-INTERNAL authored / PARTNER-addressed + SERVICE-CONTEXTUAL | via run | no | Verify |
| 67 | `verify_raw_review_grants` | SCO-INTERNAL / OPERATOR CONTEXT (partner consent gated) | via request | no | Verify |
| 68 | `verify_raw_content_access_events` | SCO-INTERNAL / OPERATOR CONTEXT | via revision | no | Verify |
| 69 | `partner_verify_result_get` projection | SERVICE-CONTEXTUAL partner read boundary | `app.tenant_id` = partner | no | Verify |
| 70 | global catalog (`product_categories`, `product_identities`, `unit_definitions`, `currency_definitions`, `category_attribute_definitions`, `product_attribute_values`) | CROSS-DOMAIN REFERENCE / platform catalog | none (global read) | no | no |
| 71 | `product_candidates` / `product_match_assessments` | COMPANY-OWNED CONTEXT with SCO-INTERNAL review | `company_id` + RLS | no | no |
| 72 | `tenant_probes` | COMPANY-OWNED CONTEXT (isolation test fixture) | `company_id` + RLS | no | no |

**72 domain/asset entries mapped.**

### E.1 Identity

#### `User`

| Field | Value |
| --- | --- |
| Current repository representation | `model User` in `apps/api/prisma/schema.prisma`; table `"User"` created in migration `0001_foundation` |
| Owner / authoritative context | GLOBAL IDENTITY / PLATFORM PRIMITIVE |
| Organizational context | None. A user exists independently of any company |
| Tenant / company context | None. CURRENTLY ENFORCED: no RLS on `"User"` (documented as system-scoped in `docs/architecture/tenant-isolation.md`) |
| Project context | Not applicable |
| Service context | Not applicable |
| Who may act today | Authentication flow only. `sco_runtime` mutation on `"User"` was revoked in migration `0003_runtime_role_least_privilege` |
| Current authorization / enforcement | `AuthGuard` resolves a user from a session cookie (`apps/api/src/modules/auth/guards/auth.guard.ts`); disabled users are rejected in `apps/api/src/modules/auth/session.service.ts` |
| Current database enforcement | System-scoped, no RLS; least-privilege grants only |
| Current audit / history evidence | `audit_logs.actor_user_id` references `"User"` (`0004_rbac_audit_documents`) |
| Known boundary / confidentiality rule | CURRENTLY ENFORCED: a `User` is global; it must not be treated as the owner of company work assets |
| Cross-domain dependencies | Referenced by nearly every domain as actor/creator |
| Strategic compatibility note | Compatible with multi-company membership and with a future service-account concept; no service-account model exists today |
| Repository evidence | `apps/api/prisma/schema.prisma`; `0001_foundation`; `0003_runtime_role_least_privilege`; `docs/architecture/tenant-isolation.md` |

A single non-human identity exists: `public.verify_system_actor_id()` returns the fixed UUID `00000000-0000-4000-9000-000000005357`, inserted as a `"User"` row by migration `0084_verify_line_results_execution`. CURRENTLY ENFORCED: Verify SYSTEM gateways accept no caller-supplied actor parameter, so SYSTEM actions cannot be attributed to an arbitrary user. This is a fixed system account, NOT a general service-account model.

#### `Session`

| Field | Value |
| --- | --- |
| Current repository representation | `model Session`; table `"Session"` (`0001_foundation`) |
| Owner / authoritative context | GLOBAL IDENTITY / PLATFORM PRIMITIVE (user-bound) |
| Organizational context | None — a session is not bound to a company |
| Tenant / company context | None. System-scoped, no RLS |
| Project / service context | Not applicable |
| Who may act today | The authenticated user (implicitly), via `AuthGuard` and logout |
| Current authorization / enforcement | SHA-256 token hash only; 8-hour absolute lifetime, 30-minute idle lifetime, revocation, and user-status recheck on every protected request (`apps/api/src/modules/auth/session.service.ts`) |
| Current database enforcement | System-scoped; `sco_runtime` holds only the session CRUD authentication requires |
| Current audit / history evidence | NOT ENOUGH EVIDENCE of a dedicated session audit trail |
| Known boundary / confidentiality rule | CURRENTLY ENFORCED: the raw token is never stored |
| Cross-domain dependencies | Gate for every authenticated surface |
| Strategic compatibility note | Session carries no company selection; tenant choice is a per-request header, which is compatible with multi-workspace switching |
| Repository evidence | `0001_foundation`; `apps/api/src/modules/auth/session.service.ts`; `apps/api/src/modules/auth/auth.controller.ts`; `docs/architecture/tenant-isolation.md` |

### E.2 Organization / Tenant

#### `Company`

| Field | Value |
| --- | --- |
| Current repository representation | `model Company`; table `"Company"`; `enum CompanyType { SCO, PARTNER, SUPPLIER, OTHER }`; `enum CompanyStatus { ACTIVE, SUSPENDED }` |
| Owner / authoritative context | GLOBAL IDENTITY / PLATFORM PRIMITIVE (directory of organizations) |
| Organizational context | It *is* the organizational context for every other asset |
| Tenant / company context | Directory table itself is system-scoped (no RLS), per `docs/architecture/tenant-isolation.md` |
| Project / service context | Not applicable |
| Who may act today | Read via `CompanyAccessController` restricted to the caller's own tenant; `OperationsController` reads only `WHERE id = $1` bound to the tenant |
| Current authorization / enforcement | `AuthGuard` + `TenantGuard`; `CompanyAccessController` rejects any `companyId` other than the resolved tenant |
| Current database enforcement | `sco_runtime` mutation revoked in `0003_runtime_role_least_privilege`; read-only |
| Current audit / history evidence | `audit_logs.company_id` |
| Known boundary / confidentiality rule | CURRENTLY ENFORCED: `Company.type` is a server-side fact. `PartnerCompanyGuard` re-checks `type='PARTNER' AND status='ACTIVE'` because `TenantGuard` alone never asserts type |
| Cross-domain dependencies | Referenced by membership, RBAC, projects, documents, procurement, Verify |
| Strategic compatibility note | The four-value `CompanyType` already distinguishes SCO / PARTNER / SUPPLIER / OTHER, which is the structural basis any future workspace separation would build on |
| Repository evidence | `apps/api/prisma/schema.prisma`; `0001_foundation`; `0003_runtime_role_least_privilege`; `apps/api/src/common/tenant/partner-company.guard.ts`; `apps/api/src/modules/identity/company-access.controller.ts` |

#### `CompanyMembership`

| Field | Value |
| --- | --- |
| Current repository representation | `model CompanyMembership`; table `"CompanyMembership"`; `@@unique([userId, companyId])`; `enum MembershipStatus { ACTIVE, SUSPENDED, REVOKED }` |
| Owner / authoritative context | COMPANY-OWNED CONTEXT |
| Organizational context | The join between a global `User` and one `Company` |
| Tenant / company context | CURRENTLY ENFORCED: `ENABLE`/`FORCE ROW LEVEL SECURITY` with a tenant policy on `app.tenant_id` (`0001_foundation`), plus one narrow bootstrap read policy on `app.actor_id` (`0002_security_gate_identity`) that returns only the caller's own membership rows |
| Project / service context | Not applicable directly; `project_members` references it |
| Who may act today | Resolution only, server-side. `MembershipsService.requireActiveMembership` resolves the sole ACTIVE membership, or validates the explicit `x-sco-company-id` header; ambiguity is rejected rather than guessed |
| Current authorization / enforcement | `TenantGuard` → `MembershipsService`; suspended, revoked, foreign, or ambiguous selections are denied |
| Current database enforcement | FORCE RLS; bootstrap policy grants no access to tenant business rows; `sco_runtime` mutation revoked in `0003` |
| Current audit / history evidence | NOT ENOUGH EVIDENCE of a dedicated membership-lifecycle history table |
| Known boundary / confidentiality rule | **CRITICAL (preserve):** `CompanyMembership` is *organizational membership*. It is NOT a Service Access model and must not be reinterpreted as one |
| Cross-domain dependencies | Root of RBAC (`MembershipRole`), Verify partner authorization, `ScoInternalGuard`, `project_members` |
| Strategic compatibility note | Multi-company membership is already supported and already requires explicit tenant selection, so isolated multi-company workspaces are an additive extension rather than a model conflict |
| Repository evidence | `0001_foundation`; `0002_security_gate_identity`; `apps/api/src/modules/identity/memberships.service.ts`; `apps/api/src/common/tenant/tenant.guard.ts`; `apps/api/test/database/postgres-rls.integration.test.ts` |

#### `CompanyPartnership`

| Field | Value |
| --- | --- |
| Current repository representation | `model CompanyPartnership`; table `company_partnerships`; `enum PartnershipType { BUYER_PARTNERSHIP, SUPPLIER_PARTNERSHIP }`; `@@unique([companyId, type])` |
| Owner / authoritative context | SCO-INTERNAL / OPERATOR CONTEXT for creation and activation; tenant-readable for the company concerned |
| Organizational context | Declares the commercial relationship class a company holds with SCO |
| Tenant / company context | `company_id` with a tenant policy. CURRENTLY ENFORCED: migration `0085` replaced `partnership_sco_internal_or_active_tenant` with `partnership_active_tenant`, removing the `app.sco_internal` GUC bypass |
| Project / service context | Not applicable |
| Who may act today | SCO internal staff with `partnership.manage` via `internal_partnership_create` / `internal_partnership_activate`, exposed at `POST /api/v1/internal/network/companies/:companyId/partnerships` behind `ScoInternalGuard` |
| Current authorization / enforcement | `AuthGuard` + `ScoInternalGuard`; gateway re-checks `internal_has_capability(p_actor,'partnership.manage')` |
| Current database enforcement | Tenant policy for `sco_runtime`; separate `company_partnerships_gateway_owner` policy for `sco_internal_gateway_owner` (`0085`) |
| Current audit / history evidence | NOT ENOUGH EVIDENCE of partnership-specific history beyond `audit_logs` |
| Known boundary / confidentiality rule | Partnership status is distinct from membership status; being a SUPPLIER_PARTNERSHIP does not grant any supplier login/access path |
| Cross-domain dependencies | `supplier_qualifications`, `supplier_category_capabilities`, `purchase_sources` all key off the supplier partnership |
| Strategic compatibility note | Relationship class is already modelled separately from membership and from permission, which keeps "subscription ≠ permission" structurally open |
| Repository evidence | `apps/api/prisma/schema.prisma`; `0085_internal_gateway_security_remediation`; `apps/api/src/modules/identity/qualification.controller.ts`; `apps/api/test/database/qualification-partnerships.integration.test.ts` |

#### `qualification_applications`

| Field | Value |
| --- | --- |
| Current repository representation | `model QualificationApplication`; table `qualification_applications` |
| Owner / authoritative context | SCO-INTERNAL / OPERATOR CONTEXT |
| Organizational context | Pre-organizational: an applicant has no company context yet |
| Tenant / company context | **None.** CURRENTLY ENFORCED: migration `0085` executed `REVOKE ALL ON qualification_applications FROM sco_runtime` and dropped `qualification_sco_internal_only` — there is no legitimate tenant path at all |
| Project / service context | Not applicable |
| Who may act today | SCO internal staff with `qualification.manage` via `internal_qualification_create` / `_decide` / `_list` |
| Current authorization / enforcement | `ScoInternalGuard` + capability check inside each gateway |
| Current database enforcement | Only `sco_internal_gateway_owner` holds privilege, via `qualification_applications_gateway_owner` policy |
| Current audit / history evidence | `reviewed_by`, `reviewed_at`, `decision_reason` columns; `audit_logs` |
| Known boundary / confidentiality rule | An applicant is not a tenant; qualification data must not become partner-visible by default |
| Cross-domain dependencies | Precedes `Company` / partnership creation |
| Strategic compatibility note | Demonstrates an already-existing "SCO-operated, no tenant path" pattern distinct from partner context |
| Repository evidence | `0085_internal_gateway_security_remediation`; `apps/api/src/modules/identity/qualification.service.ts` |

#### Partner / Supplier / SCO representation

CURRENTLY REPRESENTED: all three are values of one `CompanyType` enum on one `Company` table. There are no separate partner/supplier/internal organization tables.

- **Partner representation** — enforced where it matters: `PartnerCompanyGuard` (`apps/api/src/common/tenant/partner-company.guard.ts`) and the SQL predicates inside `partner_verify_read_allowed` / `partner_verify_write_allowed`, which both require `company.type = 'PARTNER' AND company.status = 'ACTIVE'`.
- **Supplier representation** — `Company.type='SUPPLIER'` rows are referenced by `supplier_company_id` on internal records. NOT IMPLEMENTED: any supplier authentication, supplier membership path, or supplier-facing endpoint.
- **SCO/internal representation** — `Company.type='SCO'` plus the `sco.internal.manage` permission is what `ScoInternalGuard` requires (`apps/api/src/modules/identity/sco-internal.guard.ts`). CURRENTLY ENFORCED: SCO staff are members of the SCO company, **not** of a partner company.

### E.3 Authorization

#### `Role`, `Permission`, `MembershipRole`, `RolePermission`

| Field | Value |
| --- | --- |
| Current repository representation | Tables `"Role"`, `"Permission"`, `"MembershipRole"`, `"RolePermission"` created in `0004_rbac_audit_documents` |
| Owner / authoritative context | `"Permission"` = GLOBAL IDENTITY / PLATFORM PRIMITIVE (globally unique `code`, no `company_id`). `"Role"`, `"MembershipRole"`, `"RolePermission"` = COMPANY-OWNED CONTEXT (each carries `company_id`) |
| Organizational context | Role assignment is per company; permission vocabulary is platform-wide |
| Tenant / company context | CURRENTLY ENFORCED: `ENABLE` + `FORCE ROW LEVEL SECURITY` with `role_tenant`, `membership_role_tenant`, `role_permission_tenant` policies on `app.tenant_id` |
| Project / service context | Not applicable. NOT IMPLEMENTED: project-scoped or service-scoped permissions |
| Who may act today | Evaluated, not administered via HTTP. NOT ENOUGH EVIDENCE of a role-administration endpoint |
| Current authorization / enforcement | `PermissionGuard` + `PermissionsService.has()` join `MembershipRole → RolePermission → Permission` inside a tenant transaction |
| Current database enforcement | FORCE RLS on all three company-scoped tables; narrow bootstrap read policies for gateway-owner roles added by `0084`/`0085`/`0086` |
| Current audit / history evidence | NOT ENOUGH EVIDENCE of RBAC-change history |
| Known boundary / confidentiality rule | **CRITICAL (preserve):** permission is an authorization fact. Subscription/entitlement is NOT IMPLEMENTED and must not be conflated with `Permission` |
| Cross-domain dependencies | Every guarded route; every `internal_has_capability` call; Verify partner gateways |
| Strategic compatibility note | Because `Permission` is global while assignment is company-scoped, adding a separate entitlement dimension later is additive |
| Repository evidence | `0004_rbac_audit_documents`; `0075_current_rbac_reconciliation`; `apps/api/src/modules/rbac/permission.guard.ts`; `apps/api/src/modules/rbac/permissions.service.ts` |

#### Tenant context (enforcement primitive)

CURRENTLY ENFORCED mechanism, not a stored asset:

- `app.actor_id` is set transaction-locally by `RuntimeDatabaseService.withActor`.
- `app.tenant_id` is set transaction-locally by `TenantTransactionService.withTenant` (`apps/api/src/database/tenant-transaction.service.ts`), only after `TenantGuard` has validated an ACTIVE membership in an ACTIVE company.
- Every tenant policy compares `company_id` to `NULLIF(current_setting('app.tenant_id', true), '')::uuid`, so a missing GUC resolves to NULL and denies.
- The documented lifecycle is in `docs/architecture/tenant-isolation.md`; it is proven by `apps/api/test/database/postgres-rls.integration.test.ts` and `apps/api/test/database/rls-context.integration.test.ts`, which connect as `sco_runtime` and test cross-tenant SELECT/UPDATE/DELETE/INSERT, missing context, context reuse, `SET row_security = off`, and absence of `BYPASSRLS`/ownership.

#### Internal executor / gateway context

CURRENTLY ENFORCED: SCO-INTERNAL / OPERATOR CONTEXT is a distinct database identity chain, not a flag on the tenant path.

| Role | Purpose | Introduced |
| --- | --- | --- |
| `sco_runtime` | Tenant request execution; `NOBYPASSRLS`, owns nothing | `0001` / `0003` |
| `sco_internal_executor` | EXECUTE-only caller for `internal_*` gateways | `0015` |
| `sco_internal_gateway_owner` | NOLOGIN owner of internal SECURITY DEFINER gateways | `0085` |
| `sco_verify_system_executor` | EXECUTE-only caller for Verify SYSTEM gateways | `0084` |
| `sco_verify_gateway_owner` | NOLOGIN owner of Verify SYSTEM gateways | `0084` |
| `sco_verify_partner_read_owner` | NOLOGIN owner of the three partner Verify read functions; SELECT-only on exactly ten tables | `0086` |

CURRENTLY ENFORCED: migration `0085` removed `app.sco_internal` as a sufficient security boundary for sensitive internal operations, replacing caller-set-GUC authorization with typed gateways that each call `internal_has_capability(p_actor, '<capability>')`. Residual purpose-specific GUCs remain for narrow non-authorization uses (`app.audit_system` in `0004`, `app.offer_gateway` in `0028`); these are not a general internal-access bypass.

### E.4 Projects

#### `projects`, `project_members`, `project_member_disciplines`

| Field | Value |
| --- | --- |
| Current repository representation | Tables created in `0009_rolling_planning`: `projects(company_id, code, name, status, created_by, …)` with `UNIQUE(company_id, code)`; `project_members(company_id, project_id, company_membership_id, status, …)`; `project_member_disciplines` |
| Owner / authoritative context | COMPANY-OWNED CONTEXT; PROJECT-CONTEXTUAL as a secondary dimension |
| Organizational context | A project belongs to exactly one company |
| Tenant / company context | CURRENTLY ENFORCED: `projects_tenant`, `project_members_tenant` policies on `app.tenant_id`, with `ENABLE` + `FORCE ROW LEVEL SECURITY` |
| Project context | This is the project primitive. Project membership is expressed as `company_membership_id`, i.e. project access derives from organizational membership |
| Service context | Not applicable |
| Who may act today | Tenant users through the runtime role. NOT ENOUGH EVIDENCE of a project CRUD HTTP controller |
| Current authorization / enforcement | Tenant RLS. NOT IMPLEMENTED: project-level permission checks in the application layer |
| Current database enforcement | FORCE RLS tenant policies; `0085` additionally granted `sco_internal_gateway_owner` a read-only `projects_gateway_owner` SELECT policy because `internal_execution_assign` reads project status |
| Current audit / history evidence | `audit_logs`; project-linked procurement records carry their own history |
| Known boundary / confidentiality rule | **CRITICAL (preserve):** project context is *secondary* to company context. `company_id` is the authoritative tenant key on every project-linked record; `project_id` is nullable on `procurement_needs` and `rfq_items` |
| Cross-domain dependencies | `procurement_needs.project_id`, `procurement_execution_items.project_id`, `rfq_items.project_id` |
| Strategic compatibility note | Project context already exists and is already subordinate to company context, which is compatible with later contextual grouping without re-parenting data |
| Repository evidence | `0009_rolling_planning`; `0085_internal_gateway_security_remediation`; `apps/api/test/database/rolling-planning.integration.test.ts` |

### E.5 Documents

#### `documents` and `document_versions`

| Field | Value |
| --- | --- |
| Current repository representation | `0004_rbac_audit_documents`: `documents(company_id, uploader_user_id, filename, detected_mime_type, byte_size, storage_key UNIQUE, sha256, status)`, `document_versions(company_id, document_id, version, storage_key, sha256)`. `0020_supplier_quote_document_access_isolation` added `documents.access_scope TEXT CHECK (access_scope IN ('TENANT','SCO_INTERNAL'))` |
| Owner / authoritative context | COMPANY-OWNED CONTEXT, **partitioned by `access_scope`** |
| Organizational context | Every document row carries a company; `access_scope='SCO_INTERNAL'` marks documents the owning tenant must not read through the tenant path |
| Tenant / company context | CURRENTLY ENFORCED: `document_tenant` policy requires `access_scope='TENANT' AND company_id = app.tenant_id`; `document_version_tenant` on `company_id` |
| Project context | Not applicable directly |
| Service context | Verify references documents for raw content and evidence, but ownership stays with the document's company |
| Who may act today | Tenant users for TENANT-scoped documents; SCO internal staff with `quote.document.read` for supplier quote documents via a SECURITY DEFINER gateway |
| Current authorization / enforcement | Tenant RLS; `get_supplier_quote_document(p_document_id, p_actor_id)` requires an ACTIVE membership in an ACTIVE `type='SCO'` company holding `quote.document.read`, and is EXECUTE-granted only to `sco_internal_executor` |
| Current database enforcement | FORCE RLS on `documents`, `document_versions`, `supplier_quote_documents`; `REVOKE ALL … FROM PUBLIC` on the gateway function |
| Current audit / history evidence | `audit_logs` entries for procurement document upload/extraction; `supplier_po_commercial_documents` are immutable via `prevent_supplier_po_commercial_document_mutation` (`0046`) |
| Known boundary / confidentiality rule | CURRENTLY ENFORCED: `storage_key` is never returned to a client. `SupplierQuoteDocumentService.metadata()` returns only filename/mime/size; content is streamed via `storage.readPrivate(storage_key)` server-side. `apps/api/test/database/warranty-entitlement-foundation.integration.test.ts` asserts `storage_key` is absent from a projection |
| Cross-domain dependencies | Procurement extraction, supplier quotes, supplier PO commercial documents, Verify raw content and evidence |
| Strategic compatibility note | `access_scope` already provides a two-value confidentiality partition on a company-owned table — an existing precedent for separating operator-held artefacts from tenant-readable ones |
| Repository evidence | `0004_rbac_audit_documents`; `0020_supplier_quote_document_access_isolation`; `0046_supplier_commercial_document_foundation`; `apps/api/src/modules/documents/storage-provider.ts`; `apps/api/src/modules/documents/supplier-quote-document.service.ts`; `apps/api/test/database/supplier-quote-document-isolation.integration.test.ts` |

Storage: `createDocumentStorageProvider` enforces that `SCO_DOCUMENT_STORAGE=local` is permitted only in development or test, and requires S3 configuration otherwise (`apps/api/src/modules/documents/storage-provider.ts`). The provider interface exposes `stage`, `authorizeDownload`, and `readPrivate`.

NOT IMPLEMENTED, explicitly: watermarking, export controls, expiring access links, retention rules, disposal/erasure mechanisms.

#### `procurement_documents` / `procurement_document_lines`

| Field | Value |
| --- | --- |
| Current repository representation | `0008_procurement_document_extraction`; both carry `company_id` |
| Owner / authoritative context | COMPANY-OWNED CONTEXT |
| Tenant / company context | CURRENTLY ENFORCED tenant RLS |
| Who may act today | Tenant users via `POST /api/v1/procurement-documents/:id/extract` behind `AuthGuard` + `TenantGuard` |
| Current authorization / enforcement | Tenant guard only. NOT IMPLEMENTED: a `@RequirePermission` on this route |
| Current audit / history evidence | `procurement_document.uploaded`, `procurement_document.extraction_completed`, `procurement_document.extraction_failed` audit actions |
| Known boundary / confidentiality rule | Extracted lines stay inside the uploading company's tenant context |
| Repository evidence | `0008_procurement_document_extraction`; `apps/api/src/modules/documents/procurement-documents.service.ts`; `apps/api/test/database/procurement-documents.integration.test.ts` |

#### Verify documents

`verify_quote_revisions.raw_content_document_id` / `raw_content_version_id` and `verify_evidence_bindings.document_id` / `document_version_id` are CROSS-DOMAIN REFERENCES into the document domain. CURRENTLY ENFORCED: triggers `verify_quote_revision_document_valid` and `verify_evidence_document_valid` (`0082`) reject any document or version that does not belong to the same company as the owning Verify request. Ownership remains with the document's company; Verify does not take ownership of the artefact.

### E.6 Audit / History

#### `audit_logs`

| Field | Value |
| --- | --- |
| Current repository representation | `0004_rbac_audit_documents`: `audit_logs(company_id NULLABLE, actor_user_id, scope "AuditScope", action, entity_type, entity_id, metadata JSONB, correlation_id, created_at)` with `CHECK ((scope='TENANT' AND company_id IS NOT NULL) OR scope <> 'TENANT')`; `enum AuditScope { TENANT, SYSTEM, SCO_INTERNAL, PRE_TENANT }` |
| Owner / authoritative context | SHARED OPERATIONAL RECORD — genuinely partitioned by `scope`, not merely referenced by many domains |
| Organizational context | `TENANT` rows are company-owned; `SYSTEM`, `SCO_INTERNAL`, `PRE_TENANT` rows have no tenant owner |
| Tenant / company context | CURRENTLY ENFORCED: `audit_tenant` policy on `app.tenant_id`; plus `audit_system_insert`, an INSERT-only policy requiring `scope <> 'TENANT' AND current_setting('app.audit_system', true) = 'true'` |
| Project / service context | Not applicable |
| Who may act today | Insert-only in practice: tenant writes through `AuditService.record` with scope TENANT; non-tenant scopes through the `app.audit_system` INSERT path; internal gateways insert directly as `sco_internal_gateway_owner` / `sco_verify_gateway_owner` |
| Current authorization / enforcement | `AuditService` requires both actor and company for TENANT scope and throws `TENANT_AUDIT_CONTEXT_REQUIRED` otherwise; metadata keys matching `/password\|token\|secret\|credential\|authorization\|cookie/i` are stripped before insert |
| Current database enforcement | FORCE RLS; narrow insert-only policies such as `verify_gateway_owner_audit_insert` (`0084`) |
| Current audit / history evidence | This *is* the audit evidence |
| Known boundary / confidentiality rule | CURRENTLY ENFORCED: a TENANT audit row cannot exist without a company; secrets are filtered from metadata |
| Cross-domain dependencies | Written by identity, catalog, documents, procurement, commercial, and Verify gateways |
| Strategic compatibility note | Scope partitioning already separates operator actions from tenant actions in one immutable-by-convention stream |
| Repository evidence | `0004_rbac_audit_documents`; `apps/api/src/modules/audit/audit.service.ts`; `apps/api/test/database/batch-8-audit-coverage.integration.test.ts` |

#### Domain-specific immutable records

CURRENTLY ENFORCED immutability, by trigger:

| Records | Mechanism | Migration |
| --- | --- | --- |
| `verify_quote_revisions` (pre-`0083`), `verify_quote_line_adjustments`, `verify_quote_level_adjustments`, `verify_evidence_bindings`, `verify_raw_content_access_events` | `prevent_verify_immutable_mutation` raising `VERIFY_HISTORY_IMMUTABLE` | `0082` |
| `verify_run_line_scope`, `verify_line_results`, `verify_line_result_evidence` | same function | `0084` |
| `verify_quote_lines`, `verify_runs`, `verify_results`, `verify_requests`, `verify_quote_revisions` | transition-only triggers (`*_transition_only`, `*_lifecycle_only`) that permit only approved state moves and reject every field rewrite | `0082`, `0083`, `0084` |
| `partner_offer_revisions`, `partner_offer_lines`, `offer_internal_bindings`, `offer_approvals` | `prevent_offer_history_mutation` | `0028` |
| `supplier_po_commercial_documents`, `…_line_coverage` | `prevent_supplier_po_commercial_document_mutation` | `0046` |
| `supplier_payment_schedule_items` once APPROVED/SUPERSEDED | `prevent_supplier_payment_schedule_item_mutation` | `0056` |
| active `product_identities` | `prevent_active_product_identity_mutation` | `0006` |

Verify immutability is enforced for **every** role including the database owner. `apps/api/test/database/supplier-delivery-execution.integration.test.ts` similarly proves event update/delete is rejected "even when attempted by the database owner".

Append-only history tables: `procurement_need_history`, `product_candidate_history`, `supplier_network_history`.

NOT IMPLEMENTED: retention, expiry, or disposal of any history record.

### E.7 RFQ / Procurement

This is the domain where ownership is most frequently misread. The decisive evidence is which tables carry `company_id` **and** a tenant policy.

#### Partner-side demand (COMPANY-OWNED CONTEXT)

`procurement_needs`, `procurement_plans`, `procurement_plan_items`, `procurement_need_approvals`, `company_disciplines` — all created in `0009_rolling_planning` with `company_id`, `ENABLE`/`FORCE ROW LEVEL SECURITY`, and `*_tenant` policies on `app.tenant_id`. `procurement_needs` additionally carries a nullable `project_id`, making it PROJECT-CONTEXTUAL under company ownership. CURRENTLY ENFORCED: `0085` granted `sco_internal_gateway_owner` `SELECT, UPDATE` on `procurement_needs` (UPDATE only because `internal_execution_assign` takes a `FOR UPDATE` row lock) with a `procurement_needs_gateway_owner` policy.

#### SCO-operated execution (SCO-INTERNAL / OPERATOR CONTEXT)

| Table | Evidence of operator ownership |
| --- | --- |
| `procurement_cycles` | `0085`: `REVOKE ALL … FROM sco_runtime`, `DROP POLICY cycles_internal` — no tenant path at all |
| `procurement_executions` | `0085`: `REVOKE ALL … FROM sco_runtime`, `DROP POLICY executions_internal` |
| `rfqs` | `0013`: the table has **no `company_id` column** — `rfqs(id, status, created_by, issued_by, issued_at, expires_at, related_rfq_id, internal_notes, correlation_id, …)` |
| `rfq_recipients` | `0013`: keyed by `purchase_source_id` + `supplier_company_id`; no buyer company column |
| `supplier_quotes` | `0013`: keyed by `rfq_id`, `purchase_source_id`, `supplier_company_id` |
| `supplier_quote_revisions` | `0013`: keyed by `supplier_quote_id`; immutability proven in `supplier-quote-revision-immutability.integration.test.ts` |
| `purchase_sources`, `supplier_qualifications`, `supplier_category_capabilities`, `purchase_source_type_definitions`, `purchase_source_contacts`, `supplier_network_history` | `0085` Section 7: `REVOKE ALL … FROM sco_runtime` for all six, policies replaced by `*_gateway_owner` |

`rfq_items` is the nuance: it **does** carry `company_id` and `project_id` (`0013`), because an RFQ line traces back to a specific buyer need. That column is a **CROSS-DOMAIN REFERENCE identifying the buyer**, not a tenant grant — the RFQ aggregate it belongs to has no tenant path, and RFQ operations run through `internal_rfq_*` gateways via `InternalDatabaseService`. Classified SCO-INTERNAL / OPERATOR CONTEXT with a buyer reference.

#### Genuinely shared operational records

`procurement_execution_items`, `ready_allocation_events`, `procurement_cycle_exceptions`, `execution_change_requests` are classified SHARED OPERATIONAL RECORD because `0085` deliberately **kept** a tenant policy on each (`%I_tenant` on `company_id`) *and* granted `sco_internal_gateway_owner` full gateway access. Both contexts legitimately operate on the same rows: SCO assigns and progresses them; the owning company reads status. The partner-visible read path is `ExecutionService.partnerStatus`, which maps internal statuses to a coarser partner vocabulary (`apps/api/src/modules/identity/execution.service.ts`).

#### Downstream commitment / purchasing

| Record | Ownership key | Classification |
| --- | --- | --- |
| `approved_purchase_cost_snapshots` (`0024`) | internal selection record | SCO-INTERNAL / OPERATOR CONTEXT |
| `supplier_purchase_orders` (`0038`) | `purchase_source_id`, `supplier_company_id`, `lead_procurement_engineer_id` — no buyer company | SCO-INTERNAL / OPERATOR CONTEXT |
| `procurement_releases` (`0033`) | `commercial_commitment_id`, `partner_company_id` | SCO-INTERNAL / OPERATOR CONTEXT with partner reference |
| `commercial_commitments` (`0029`) | `partner_company_id`, `partner_purchase_order_id`, `accepted_offer_revision_id` | SHARED OPERATIONAL RECORD |
| supplier payment schedules, delivery tranches, delivery execution, funding, cash exposure | internal gateways only | SCO-INTERNAL / OPERATOR CONTEXT |
| partner delivery receipt/acceptance/discrepancy | `partner_delivery_*` gateways with `partner_delivery_execution_owned` ownership check | PARTNER-OWNED CONTEXT |
| buying-power snapshots, classification runs, views | `internal_buying_power_*` gateways | SCO-INTERNAL / OPERATOR CONTEXT |
| supplier future demand frameworks (`0077`–`0081`) | `internal_supplier_future_demand_framework_*` | SCO-INTERNAL / OPERATOR CONTEXT |

Scoped supplier-PO visibility is itself permission- and assignment-gated: `apps/api/test/database/supplier-po-scoped-visibility.integration.test.ts` asserts the gateways "require both read permission and a valid source/category assignment" and "prevent direct table reads for runtime and executor roles".

### E.8 Verify

Verify is a **SERVICE-CONTEXTUAL** domain. Its ownership splits cleanly between partner-owned input and operator-owned processing.

| Asset | Ownership key | Classification | Immutability |
| --- | --- | --- | --- |
| `verify_requests` | `company_id` (+ `PARTNER` type enforced by the write/read gateways) | PARTNER-OWNED CONTEXT | `verify_request_lifecycle_only` |
| `verify_quote_revisions` | via `verify_request_id` | PARTNER-OWNED CONTEXT | `verify_quote_revision_lifecycle_only` (DRAFT→SUBMITTED only) |
| `verify_quote_lines`, `…_line_adjustments`, `…_level_adjustments` | via revision | PARTNER-OWNED CONTEXT | `verify_quote_line_transition_only`; frozen once any FINAL/SUPERSEDED result exists |
| `verify_runs` | via revision | SCO-INTERNAL / OPERATOR CONTEXT | `verify_run_transition_only`; one active run per revision (`verify_runs_one_active_per_revision`) |
| `verify_evidence_bindings` | via run | SCO-INTERNAL / OPERATOR CONTEXT | fully immutable; insert only while run is RUNNING |
| `verify_run_line_scope` | via run | SCO-INTERNAL / OPERATOR CONTEXT | fully immutable; captures coverage inputs once at run creation |
| `verify_line_results`, `verify_line_result_evidence` | via run | SCO-INTERNAL / OPERATOR CONTEXT | fully immutable |
| `verify_results` | via run | SCO-INTERNAL authored, PARTNER-addressed | `verify_result_transition_only`; PREPARED→FINAL→SUPERSEDED only; one result per run (`verify_results_run_unique`) |
| `verify_raw_review_grants` | via request | SCO-INTERNAL / OPERATOR CONTEXT, partner-consent gated | `CHECK (authorized_by <> actor_user_id)`, `CHECK (expires_at > starts_at)` |
| `verify_raw_content_access_events` | via revision | SCO-INTERNAL / OPERATOR CONTEXT | fully immutable |

Shared Verify facts:

- **Tenant / company context** — CURRENTLY ENFORCED: all ten Verify tables have `ENABLE` + `FORCE ROW LEVEL SECURITY` and `REVOKE ALL … FROM PUBLIC, sco_runtime, sco_internal_executor`, with `*_tenant` policies for `sco_runtime` resolving the chain back to `verify_requests.company_id` (`0082`, `0084`).
- **Project context** — NOT IMPLEMENTED. No Verify table references `projects`.
- **Who may act today** — partners with `partner_verify.write` through `partner_verify_*` lifecycle gateways (`0083`); SCO analysts/approvers with `verify.analyst` / `verify.approver` through `internal_verify_*` gateways; the fixed SYSTEM actor through `internal_verify_system_*` gateways (`0084`); partners with `partner_verify.read` through the result projection (`0086`).
- **Known boundary (preserve)** — the internal result may carry evidence provenance, variance, confidence context, exclusions and supersession links; the partner projection is a structurally separate DTO.

#### Partner-facing Verify result projection

| Field | Value |
| --- | --- |
| Current repository representation | `public.partner_verify_result_get(p_actor, p_company, p_request)` plus `partner_verify_read_allowed` and `verify_partner_read_authorized`, all created in `0086_partner_verify_result_read` |
| Owner / authoritative context | SERVICE-CONTEXTUAL read boundary over PARTNER-OWNED request data |
| Who may act today | A user with an ACTIVE membership in an ACTIVE `type='PARTNER'` company holding `partner_verify.read` |
| Current authorization / enforcement | Four HTTP guards (`AuthGuard`, `TenantGuard`, `PartnerCompanyGuard`, `PermissionGuard`) plus `@RequirePermission('partner_verify.read')`, then a second independent SQL authorization: `verify_partner_read_authorized` cross-checks `app.actor_id` and `app.tenant_id` against the parameters before any row is read |
| Current database enforcement | The three functions are owned by `sco_verify_partner_read_owner`, a NOLOGIN/NOBYPASSRLS role holding `SELECT`-only on exactly ten tables, constrained further by seven `FOR SELECT` tenant policies. `REVOKE ALL … FROM PUBLIC`; EXECUTE granted only on the outer function, only to `sco_runtime` |
| Known boundary / confidentiality rule | CURRENTLY ENFORCED: only `request_id`, `revision_id`, `run_id`, `result_id`, `status`, `classification`, `finalized_at`, and per-currency coverage counts leave the gateway. No supplier identity, supplier cost, purchase source, negotiation history, evidence identifier, confidence, variance, or exclusions JSONB is selected. The service layer re-applies an explicit allowlist in `toDto` |
| Fail-closed rule | CURRENTLY ENFORCED: the gateway counts eligible candidates first and returns zero rows unless exactly one unsuperseded FINAL result exists on the current submitted revision of a COMPLETED request. Zero rows is also the response for a nonexistent or foreign request, so object-ID possession discloses nothing |
| Repository evidence | `0086_partner_verify_result_read`; `apps/api/src/modules/verify/partner-verify.controller.ts`; `apps/api/src/modules/verify/partner-verify.service.ts`; `apps/api/test/database/partner-verify-result.integration.test.ts` (31 tests); `apps/api/test/integration/partner-verify-http.integration.test.ts` (5 tests) |

**CRITICAL (preserve): a Verify Result is not an SCO Commercial Offer.** They are different tables, different lifecycles, different authorship rules, and different partner-facing projections. `verify_results` is produced by a methodology run over partner-submitted quote data; `partner_offer_revisions` is an SCO commercial instrument priced from internal supplier cost. No code path converts one into the other.

#### Verify cross-domain data flow

NOT IMPLEMENTED / NOT ESTABLISHED: a search for references to `verify_*` tables or Verify models outside migrations `0082`–`0086` and `apps/api/src/modules/verify` returns nothing. There is CURRENTLY no automatic flow of Verify data into Procurement, Procurement Intelligence, Sales, Commercial Offer, or supplier workflows.

### E.9 Commercial / Offer domain

| Asset | Ownership key | Classification |
| --- | --- | --- |
| `pricing_cases`, `pricing_revisions`, `pricing_lines`, `pricing_cost_allocations` (`0026`) | keyed by pricing case; carries selling totals, gross margin, cost basis | SCO-INTERNAL / OPERATOR CONTEXT |
| `partner_offers` (`0028`) | `company_id` = the partner the offer is addressed to; `UNIQUE(company_id, offer_reference)`; `created_by` is an SCO user | SCO-INTERNAL authored, PARTNER-addressed |
| `partner_offer_revisions` (`0028`) | via `partner_offer_id` | SCO-INTERNAL authored, PARTNER-addressed |
| `offer_internal_bindings` (`0028`) | binds an offer revision to a `pricing_revision_id` | SCO-INTERNAL / OPERATOR CONTEXT |
| `offer_approvals` (`0028`) | internal approval record | SCO-INTERNAL / OPERATOR CONTEXT |
| `partner_purchase_orders` (`0029`) | `partner_company_id` | PARTNER-OWNED CONTEXT |

Ambiguity resolved explicitly: `partner_offers.company_id` points at the **partner**, but the offer is authored, priced, approved, issued and withdrawn exclusively by SCO staff through `internal_offer_create/submit/decide/issue/withdraw`. The only partner action is acceptance, via `partner_offer_accept`, which requires `current_setting('app.tenant_id') = p_company` and `partner_offer_capability(p_actor, p_company, 'offer.accept')`. Therefore `company_id` here is the **addressed counterparty plus the partner-read boundary**, not authorship. Separation of duties is enforced: `internal_offer_decide` raises `OFFER_SEPARATION_OF_DUTIES_REQUIRED` if the approver is the creator.

CURRENTLY ENFORCED confidentiality: `offer_internal_bindings` keeps the link from a partner-visible offer to internal pricing and supplier cost on the internal side of the boundary. `apps/api/test/database/batch-8-commercial-confidentiality.integration.test.ts` covers this separation.

### E.10 Internal / SCO Operator context

CURRENTLY IMPLEMENTED pattern, in three layers:

1. **HTTP** — `ScoInternalGuard` (`apps/api/src/modules/identity/sco-internal.guard.ts`) resolves the caller's ACTIVE membership in an ACTIVE `type='SCO'` company under `app.actor_id`, sets `app.tenant_id` to that SCO company, then requires the `sco.internal.manage` permission. Used by `/api/v1/internal/network/*`, `/api/v1/internal/catalog/*`, and the internal candidate routes.
2. **Service** — `InternalDatabaseService` (`apps/api/src/database/internal-database.service.ts`) holds a pool on `SCO_INTERNAL_DATABASE_URL` (`sco_internal_executor`) and calls only `public.internal_*` functions by name, passing an explicit actor.
3. **Database** — each `internal_*` function is SECURITY DEFINER with `SET search_path = pg_catalog, public`, owned by `sco_internal_gateway_owner`, and begins by asserting `internal_has_capability(p_actor, '<capability>')`.

Capabilities introduced by `0085`: `sco.internal.manage`, `qualification.manage`, `partnership.manage`, `candidate.manage`, `execution.manage`. Pre-existing capabilities include `catalog.manage`, `catalog.approve`, `supplier.read`, `supplier.qualify`, `purchase_source.create`, `offer.*`, `source.select`, `purchase_cost.approve`, `purchase_cost.self_approve`, `quote.document.read`.

**CRITICAL (preserve): SCO operator access is a distinct context, not partner tenant access.** An SCO user reaching an internal gateway is a member of the SCO company, has `app.tenant_id` set to the SCO company (not the partner's), and reads partner-related rows only through a definer-owned gateway that carries its own narrow privilege. NOT IMPLEMENTED: any mechanism by which an SCO employee assumes a partner tenant context, and NOT IMPLEMENTED: any Service Access model. 006-A does not introduce one.

### E.11 Supplier context

| Question | Answer |
| --- | --- |
| Are supplier organizations represented? | CURRENTLY REPRESENTED — `Company.type='SUPPLIER'`, `CompanyPartnership.type='SUPPLIER_PARTNERSHIP'` |
| Are there supplier-owned records? | **NOT IMPLEMENTED.** No table grants a supplier organization read or write access to its own rows |
| Can a supplier authenticate? | NOT ENOUGH EVIDENCE of any supplier login, supplier membership provisioning flow, or supplier portal. No supplier HTTP route exists |
| Are supplier records exposed to supplier context? | NOT IMPLEMENTED |
| What exists instead? | Supplier-related facts held in SCO-INTERNAL / OPERATOR CONTEXT: `purchase_sources`, `supplier_qualifications`, `supplier_category_capabilities`, `supplier_quotes`, `supplier_quote_revisions`, `supplier_purchase_orders`, supplier payment schedules, delivery tranches, future demand frameworks, `supplier_network_history` |

**CRITICAL (preserve):** a `supplier_company_id` column is a **commercial counterparty reference**. It is not ownership and confers no access. Migration `0085` Section 7 makes this explicit by revoking all `sco_runtime` access to the supplier-network tables, stating that "Supplier Identity, Purchase Source, and supplier network structure remain SCO-internal commercial facts". The repository `README.md` likewise records that the Supplier Portal is out of scope.

## F. Partner-owned Context Summary

CURRENTLY ENFORCED partner ownership exists for:

- Organizational: `CompanyMembership` (partner company), `Role`/`MembershipRole`/`RolePermission` scoped to that company.
- Demand: `procurement_needs`, `procurement_plans`, `procurement_plan_items`, `procurement_need_approvals`, `company_disciplines`.
- Project: `projects`, `project_members`, `project_member_disciplines`.
- Documents: `documents` with `access_scope='TENANT'`, `document_versions`, `procurement_documents`, `procurement_document_lines`.
- Catalog participation: `product_candidates`, `product_match_assessments` (tenant-scoped after `0085` narrowed the policies to `company_id` only).
- Verify input: `verify_requests`, `verify_quote_revisions`, `verify_quote_lines` and their adjustments.
- Commercial counter-position: `partner_purchase_orders`, partner delivery receipt/acceptance, partner payment receipts, warranty entitlement projections, offer acceptance.
- Verify output: the `partner_verify_result_get` projection.

Important asymmetry, CURRENTLY ENFORCED: the database contains far more partner-facing gateways than the HTTP layer exposes. `partner_offer_accept`, `partner_offer_projection`, `partner_po_submit`, `partner_purchase_order_projection`, `partner_delivery_*`, `partner_payment_*`, `partner_warranty_*`, and the `partner_verify_*` write gateways all exist in migrations, but the only partner HTTP routes at this baseline are `GET /api/v1/partner/me` and `GET /api/v1/partner/verify/requests/:requestId/result`.

## G. SCO Internal / Operator Context Summary

The operator context owns the entire sourcing and purchasing spine: cycles, executions, RFQs, recipients, supplier quotes and revisions, purchase sources, supplier qualification and capability, approved purchase cost snapshots, pricing, offer authoring and approval, procurement releases, supplier purchase orders, supplier confirmations, delivery scheduling and execution, payment schedules, funding and cash exposure, buying power, and supplier future demand frameworks.

It also owns the Verify processing side: runs, evidence bindings, run line scope, line results, the result record itself, raw-review grants, and raw-content access events.

Enforcement is uniform: `ScoInternalGuard` at HTTP, `sco_internal_executor` at the connection, typed `internal_*` SECURITY DEFINER gateways owned by a NOLOGIN gateway-owner role, and a capability assertion as the first statement of each gateway body.

## H. Supplier Context Summary

CURRENTLY: supplier organizations are modelled as companies and partnership rows, and are named on internal commercial records, but they are **not an access context**. There is no supplier-owned record, no supplier authentication path, and no supplier-facing endpoint at this baseline. Everything "supplier" is operator-held.

## I. Shared / Cross-domain Records Summary

Applying the rule that a record is not "shared" merely because several domains reference it, only these qualify as SHARED OPERATIONAL RECORD, because migration `0085` deliberately preserved both a tenant policy and a gateway-owner policy on each:

1. `audit_logs` — partitioned by `AuditScope`; TENANT rows are company-owned, other scopes are not.
2. `procurement_execution_items` — SCO progresses them, the owning company reads status.
3. `ready_allocation_events` — same dual access.
4. `procurement_cycle_exceptions` — same dual access.
5. `execution_change_requests` — same dual access.
6. `commercial_commitments` — binds a partner PO and an accepted offer revision; both sides have legitimate standing.

Classified as CROSS-DOMAIN REFERENCE rather than shared (referenced widely, owned narrowly): the global catalog (`product_categories`, `category_attribute_definitions`, `product_identities`, `product_attribute_values`, `unit_definitions`, `currency_definitions`), `User`, `Company`, `Permission`, and the document rows referenced by Verify.

## J. Current Enforcement Patterns

Five patterns are CURRENTLY ENFORCED and recur across the repository.

1. **Tenant RLS pattern** — `company_id` column + `ENABLE`/`FORCE ROW LEVEL SECURITY` + policy on `NULLIF(current_setting('app.tenant_id', true), '')::uuid` + a `NOBYPASSRLS`, non-owning `sco_runtime` role.
2. **Layered HTTP authorization** — `AuthGuard` → `TenantGuard` → (`PartnerCompanyGuard`) → `PermissionGuard` with `@RequirePermission`.
3. **Typed gateway pattern** — SECURITY DEFINER function with pinned `search_path`, owned by a dedicated NOLOGIN least-privilege role, capability asserted first, `REVOKE ALL … FROM PUBLIC`, EXECUTE granted only to the one caller role that needs it.
4. **Double authorization for partner service reads** — an application-layer permission check *and* an independent SQL check that re-derives membership, company type and permission, then cross-checks the actor/tenant GUCs against the function parameters.
5. **Transition-only immutability** — history tables rejecting all UPDATE/DELETE, and lifecycle tables permitting only enumerated state transitions with every other column compared via `IS DISTINCT FROM`.

Defence in depth is real rather than nominal: the Verify partner read path passes four HTTP guards, one SQL capability function, one GUC cross-check function, a SELECT-only role, and seven row-level policies before a row is returned.

## K. Known Ambiguities / Not Enough Evidence

| # | Item | Status | Note |
| --- | --- | --- | --- |
| 1 | `rfq_items.company_id` | Ambiguity resolved, recorded | Carries a buyer company reference but no tenant grant and belongs to a tenant-less `rfqs` aggregate. Classified operator context with buyer reference |
| 2 | `partner_offers.company_id` | Ambiguity resolved, recorded | Addressed counterparty and partner-read boundary; authorship and lifecycle are entirely SCO-internal |
| 3 | `supplier_company_id` on internal records | Ambiguity resolved, recorded | Commercial counterparty reference only; confers no access |
| 4 | Supplier authentication / portal | NOT ENOUGH EVIDENCE | No login path, membership provisioning, or endpoint found |
| 5 | Project CRUD surface | NOT ENOUGH EVIDENCE | `projects` is tenant-enforced at the database but no project controller was found |
| 6 | RBAC administration surface | NOT ENOUGH EVIDENCE | Roles and permissions are evaluated at runtime; no role-management endpoint found |
| 7 | Membership lifecycle history | NOT ENOUGH EVIDENCE | No dedicated membership history table; only `audit_logs` |
| 8 | Session audit trail | NOT ENOUGH EVIDENCE | Login/logout audit coverage not established |
| 9 | Procurement document extract route authorization | Gap recorded | `POST /api/v1/procurement-documents/:id/extract` has `AuthGuard` + `TenantGuard` but no `@RequirePermission` |
| 10 | Procurement Intelligence as a named domain | NOT IMPLEMENTED | Buying-power snapshots, classification runs and views exist; no module, API or contract named Procurement Intelligence |
| 11 | Residual purpose-specific GUCs | Recorded, not a finding | `app.audit_system` (`0004`), `app.offer_gateway` (`0028`) remain for narrow non-authorization purposes; `0085` removed `app.sco_internal` as a security boundary |
| 12 | `tenant_probes` | Recorded | A tenant-scoped isolation test fixture, not business data |

## L. Boundaries That Future Stages Must Preserve

Stated as current facts to be preserved. This section designs nothing and authorizes nothing.

1. `User` is global identity; work created by a user is owned by the company/service context, not by the user.
2. `CompanyMembership` is organizational membership and is not a Service Access model.
3. Subscription/entitlement is not implemented and is not the same thing as `Permission`.
4. `company_id` + `app.tenant_id` RLS is the authoritative tenant boundary; project context is secondary to it.
5. SCO operator context is a separate access chain (SCO membership + capability + typed definer gateway) and never becomes partner tenant context.
6. Supplier presence in data is counterparty reference, not ownership and not visibility.
7. Verify is an independent service boundary; Verify ownership must not be merged with Procurement ownership.
8. A Verify Result is not an SCO Commercial Offer.
9. There is currently no automatic flow of Verify data into Procurement, Procurement Intelligence, Sales, Commercial Offer, or supplier workflows; any such flow would be a new decision, not an implied one.
10. The partner Verify projection is an allowlist in two independent layers and fails closed on ambiguity; both properties are load-bearing.
11. Verify history immutability holds against every role including the database owner.
12. `documents.access_scope` and the `storage_key` non-disclosure rule are existing confidentiality boundaries.
13. The `0085` outcome — no caller-set GUC is a sufficient authorization boundary for sensitive internal operations — must not be reintroduced in reverse.

## M. Evidence Index

### Application code

| Path | Relevance |
| --- | --- |
| `apps/api/src/app.module.ts` | Module composition and registered controllers |
| `apps/api/src/modules/auth/guards/auth.guard.ts` | Session-based authentication |
| `apps/api/src/modules/auth/session.service.ts` | Session lifetimes, hashing, revocation |
| `apps/api/src/modules/auth/auth.controller.ts` | Login/logout surface |
| `apps/api/src/common/tenant/tenant.guard.ts` | Tenant resolution guard |
| `apps/api/src/common/tenant/partner-company.guard.ts` | Server-side `PARTNER` type enforcement |
| `apps/api/src/common/tenant/tenant-context.ts` | Tenant context type |
| `apps/api/src/modules/identity/memberships.service.ts` | Active-membership resolution, ambiguity rejection |
| `apps/api/src/modules/identity/sco-internal.guard.ts` | SCO operator context guard |
| `apps/api/src/modules/identity/company-access.controller.ts` | Tenant-bound company read |
| `apps/api/src/modules/identity/qualification.controller.ts` | Internal qualification/partnership surface |
| `apps/api/src/modules/identity/execution.service.ts` | Partner-facing execution status projection |
| `apps/api/src/modules/rbac/permission.guard.ts` | Permission enforcement |
| `apps/api/src/modules/rbac/permissions.service.ts` | RBAC join under tenant context |
| `apps/api/src/database/tenant-transaction.service.ts` | `app.tenant_id` / `app.actor_id` setting |
| `apps/api/src/database/internal-database.service.ts` | Internal gateway call surface |
| `apps/api/src/modules/documents/storage-provider.ts` | Private storage provider contract |
| `apps/api/src/modules/documents/supplier-quote-document.service.ts` | Internal document access, `storage_key` non-disclosure |
| `apps/api/src/modules/documents/procurement-documents.service.ts` | Tenant document extraction and audit |
| `apps/api/src/modules/audit/audit.service.ts` | Audit scope rules and metadata filtering |
| `apps/api/src/modules/verify/partner-verify.controller.ts` | Partner Verify route and guards |
| `apps/api/src/modules/verify/partner-verify.service.ts` | Allowlisted Verify DTO |
| `apps/api/src/modules/verify/verify.module.ts` | Verify module wiring |
| `apps/api/prisma/schema.prisma` | Models and enums |

### Migrations

| Migration | Relevance |
| --- | --- |
| `0001_foundation` | `User`, `Session`, `Company`, `CompanyMembership`, `tenant_probes`, RLS baseline |
| `0002_security_gate_identity` | `CompanyMembership` actor bootstrap policy |
| `0003_runtime_role_least_privilege` | `sco_runtime` least privilege |
| `0004_rbac_audit_documents` | RBAC tables, `audit_logs`, `documents`, `document_versions` |
| `0006_global_product_catalog` | Catalog and active-product immutability |
| `0008_procurement_document_extraction` | Procurement documents and lines |
| `0009_rolling_planning` | `projects`, `project_members`, `procurement_needs`, plans, approvals |
| `0010_weekly_procurement_execution` | Cycles, executions, execution items |
| `0011_supplier_network` | Supplier network and purchase sources |
| `0013_rfq_quotes_purchase_cost` | `rfqs`, `rfq_items`, `rfq_recipients`, supplier quotes/revisions |
| `0015` / `0021` | `sco_internal_executor`, `internal_has_capability` |
| `0020_supplier_quote_document_access_isolation` | `documents.access_scope`, `get_supplier_quote_document` |
| `0024_source_selection_authorization_audit` | Approved purchase cost snapshots |
| `0026_commercial_pricing_foundation` | Pricing cases/revisions |
| `0028_partner_offer_revisions` | Offers, bindings, approvals, offer immutability |
| `0029_partner_po_commercial_commitment` | Partner POs, commercial commitments |
| `0033_procurement_release` | Procurement releases |
| `0038_supplier_purchase_order_core` | Supplier purchase orders |
| `0046_supplier_commercial_document_foundation` | Supplier PO commercial documents, immutability |
| `0056_supplier_payment_schedule_item_insert_immutability_fix` | Payment schedule immutability |
| `0075_current_rbac_reconciliation` | RBAC reconciliation |
| `0077`–`0081` | Supplier future demand framework |
| `0082_verify_foundation` | Verify tables, RLS, immutability triggers, raw-review grants |
| `0083_verify_request_quote_lifecycle` | Verify lifecycle, partner write gateways |
| `0084_verify_line_results_execution` | Line results, SYSTEM actor, Verify gateway roles |
| `0085_internal_gateway_security_remediation` | Removal of `app.sco_internal` as a boundary; typed internal gateways |
| `0086_partner_verify_result_read` | Partner Verify read gateway, dedicated read-owner role |

### Tests

| Path | Relevance |
| --- | --- |
| `apps/api/test/database/postgres-rls.integration.test.ts` | Cross-tenant denial as `sco_runtime` |
| `apps/api/test/database/rls-context.integration.test.ts` | Tenant context handling |
| `apps/api/test/database/sr01-sr02-internal-gateway-security.integration.test.ts` | Internal gateway security after `0085` |
| `apps/api/test/database/partner-verify-result.integration.test.ts` | Partner Verify ownership, privilege and confidentiality (31 tests) |
| `apps/api/test/integration/partner-verify-http.integration.test.ts` | Partner Verify HTTP guard wiring (5 tests) |
| `apps/api/test/database/verify-foundation-security.integration.test.ts` | Verify document cross-company rejection |
| `apps/api/test/database/verify-request-quote-lifecycle.integration.test.ts` | Verify lifecycle immutability |
| `apps/api/test/database/supplier-quote-document-isolation.integration.test.ts` | Supplier document isolation |
| `apps/api/test/database/supplier-po-scoped-visibility.integration.test.ts` | Scoped supplier PO visibility |
| `apps/api/test/database/batch-8-commercial-confidentiality.integration.test.ts` | Commercial confidentiality separation |
| `apps/api/test/database/batch-8-audit-coverage.integration.test.ts` | Audit coverage |
| `apps/api/test/database/qualification-partnerships.integration.test.ts` | Qualification and partnership flow |

### Documentation consulted (and drift recorded)

| Path | Status |
| --- | --- |
| `docs/architecture/tenant-isolation.md` | Consistent with current implementation for `0001`–`0004` scope; does not cover the gateway-role architecture added by `0084`–`0086` |
| `docs/architecture/stage-005-verify-v0.1.md` | Self-described as Batch 1-A and "not implementation authorization"; much of what it describes as contract is now IMPLEMENTED by `0082`–`0086`. Treated as historical intent, not implementation truth |
| `README.md` | Records that Production deployment remains disabled and the Supplier Portal is out of scope; consistent with code |
