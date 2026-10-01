# Stage 006 — Batch 006-B — Purpose Taxonomy & Cross-Purpose Flow Contract v1

## A. Scope & Authority

This document is the official engineering contract defining the **Purposes** for which data may be used inside SCO, the boundary of each Purpose, and the rules governing **Cross-Purpose Flow**.

Authorization scope: Stage 006, Batch 006-B. This is a **contract/documentation artefact only**. It implements nothing. It creates no feature, no schema, no migration, no guard, no enforcement mechanism, no Service Access model, no Entitlement model, no Agent/Principal model, no identity masking, no document control, no Procurement Intelligence implementation, and no Digital Workspaces.

Authoritative inputs:

1. SCO Strategic Baseline — Current Approved State.
2. Strategic Baseline Addendum — Owner Approved.
3. SCO Master Engineering Roadmap v1.0 — Owner Approved.
4. SCO One Engineering Sequence v1.0 — Owner Approved.
5. `docs/architecture/stage-006-domain-data-ownership-matrix.md` — Batch 006-A, closed, Owner accepted, FCI-01 signed, pushed.

006-A is an **immutable historical baseline**. This document does not modify, reinterpret or supersede it. Where 006-A established *who owns what*, this document establishes *for what purpose it may be used*. Ownership and purpose are independent axes: owning data does not define the purposes for which it may be used, and holding access for one purpose does not extend to another.

Engineering baseline for 006-B: `35a6ac83395cd1de6d1ed104d77b639e8129ca53`, branch `main`, worktree clean at authoring time.

## B. Governing Principles

### B.1 Default Deny for Cross-Purpose Reuse (Owner-approved core rule)

**A user or service having access to data for Purpose A does not automatically authorize using that data for Purpose B.**

Corollaries, each binding:

| Statement | Meaning |
| --- | --- |
| Permission ≠ Cross-Purpose Authorization | Holding a permission authorizes an action inside a Purpose, not the export of its data to another Purpose |
| Tenant access ≠ unrestricted data reuse | A company reaching its own data for one purpose gains no right to have it reused for another |
| SCO custody ≠ unrestricted purpose | SCO storing or operating data does not make that data available for every SCO purpose |
| Internal access ≠ unrestricted commercial reuse | Operator access to a record is not commercial licence over it |
| Partner ownership ≠ supplier/source disclosure entitlement | A partner owning the need does not thereby acquire a right to SCO's sourcing, supplier identity, or buy-side cost |

Every Cross-Purpose Flow must explicitly define six elements:

```
SOURCE → DESTINATION → PURPOSE → MINIMUM DATA → AUTHORIZATION BASIS → AUDIT REQUIREMENT
```

A flow lacking any of the six is **DENIED BY DEFAULT**.

### B.2 Strategic Baseline Addendum constraints

These prospective constraints govern this contract and are applied throughout.

**B.2.A — Procurement partnership is the core relationship.** The primary customer relationship is procurement and supply partnership. Verify, Studies and Digital Workspaces are supporting or extended capabilities around that relationship. This establishes *product centrality*; it is **not** authority to merge their data purposes. Applied in: PUR-05 … PUR-13 are the core spine; PUR-14 (Verify) and PUR-18 (Studies / Engineering Advisory) remain separately bounded. PUR-17 is Procurement Intelligence and is a distinct purpose from PUR-18.

**B.2.B — Internal Supply Network.** Supplier, manufacturer, agent, distributor and pricing sources constitute SCO's internal commercial and knowledge supply network. It is **not** a partner-facing supplier directory. Supplier or source exposure must therefore never be inferred from the fact that procurement serves the partner. Applied in: PUR-08 and flows CPF-29, CPF-30.

**B.2.C — Optimal supply source.** SCO does not assume procurement from the highest point in the supply chain. Source selection is based on the economically and operationally appropriate source for the need. This contract therefore defines **no** manufacturer-first rule and places no purpose constraint on tier of source.

**B.2.D — Commercial model.** SCO negotiates and buys in its own name and presents its own sale offer; the partner accepts or rejects that offer. SCO is **not** merely the partner's negotiation agent. This contract therefore separates three distinct purposes that are frequently conflated: partner procurement need (PUR-05), SCO buy-side sourcing and negotiation (PUR-07), and SCO sell-side commercial offer (PUR-10).

**B.2.E — Low-friction procurement experience.** The product should turn customer needs into structured, processable procurement requests with low operational friction. This is a product-experience principle. It is **not** converted here into any authorization or data-use rule, and specifically does not imply that processes are instant, fully automated, or self-service.

### B.3 Policy status is not technical enforcement

Throughout this document two independent axes are reported:

- **Policy Status** — what this contract permits or denies: `ALLOWED`, `DENIED BY DEFAULT`, `OWNER DECISION REQUIRED`, `NOT IMPLEMENTED`.
- **Current Technical Enforcement** — what the repository actually enforces today: `ENFORCED`, `PARTIALLY ENFORCED`, `NOT ENFORCED (no code path exists)`, `NOT ENFORCED (access technically possible)`.

A flow is never marked `ALLOWED` merely because technical access exists, and never claimed enforced without evidence. The most consequential category is `DENIED BY DEFAULT` + `NOT ENFORCED (no code path exists)`: the absence of a flow today is not the same as a mechanism preventing one tomorrow.

## C. Terminology

| Term | Definition in this contract |
| --- | --- |
| **Purpose** | A bounded reason for which data is collected, processed or disclosed, with its own objective, permitted inputs/outputs, actors, and authorization basis |
| **Cross-Purpose Flow** | Any movement, copy, derivation, aggregation or disclosure of data from one Purpose into another |
| **Minimum Data** | The smallest field set that satisfies the destination Purpose's objective |
| **Authorization Basis** | The explicit ground on which a flow is permitted — capability, contractual relationship, consent, or Owner decision |
| **Egress** | Disclosure of data outside the organizational context that holds it, most often to a partner surface |
| **Derivation** | Producing new data from source data; a derived artefact inherits the source's purpose constraints unless a flow authorizes otherwise |
| **Aggregation** | Derivation that removes identifiability; aggregation is a mitigation, not an authorization |
| **Identifiable** | Attributable to a specific partner, project, supplier or natural person, directly or by lineage |

Purpose IDs (`PUR-nn`) and Flow IDs (`CPF-nn`) are stable engineering identifiers intended for later Stage 007 reference. They are **not** implemented in code by this batch.

## D. Purpose Classification Method

Each candidate purpose was tested against four questions, answered from repository evidence first:

1. **Distinct objective** — does it exist for a reason the other purposes do not serve?
2. **Distinct data boundary** — does the repository already separate its data, or does the Strategic Baseline require separation?
3. **Distinct authorization basis** — is access granted on a different ground (different capability, different company type, different gateway role)?
4. **Distinct disclosure risk** — would mixing it with another purpose create a disclosure that neither purpose alone would create?

A candidate became a Purpose when it satisfied (1) plus at least one of (2)–(4). Status labels used:

| Label | Meaning |
| --- | --- |
| `CURRENTLY IMPLEMENTED PURPOSE` | Exists in code/migrations with its own data and authorization |
| `CURRENTLY IMPLICIT PURPOSE` | The data and activity exist, but the purpose boundary is maintained by structure/convention rather than by an explicit purpose mechanism |
| `STRATEGICALLY APPROVED PURPOSE` | Approved in the Strategic Baseline, not yet implemented |
| `FUTURE / NOT IMPLEMENTED` | Identified for completeness; no repository evidence |
| `OWNER DECISION REQUIRED` | Boundary cannot be fixed without a product decision |

### D.1 Candidates deliberately NOT made separate Purposes

The discovery list in the authorization is explicitly not the required final taxonomy. Three candidates were rejected as purposes, each with reasoning:

**"Partner-facing Service Delivery" — REJECTED as a Purpose; reclassified as a cross-cutting egress discipline.** Evidence: the partner-facing surfaces are `partner_offer_projection` (`0028`), `partner_purchase_order_projection` (`0029`), `partner_payment_summary` (`0030`), `partner_delivery_projection_list` (`0060`, `0073`), `partner_warranty_entitlement_list` (`0076`), and `partner_verify_result_get` (`0086`). Each is bound to a different source purpose, enforces a different capability, and discloses a different minimum field set. They share a *technique*, not an objective. Making "partner-facing delivery" a purpose would create a single bucket that silently legitimises moving data between unrelated source purposes simply because both have partner surfaces — the exact failure mode this contract exists to prevent. Egress rules are therefore stated inside each source Purpose's **Permitted Outputs** and governed by section B.1.

**"SCO Internal Operations" — REJECTED as a Purpose; it is an access context.** 006-A established that SCO operator access is a distinct *access chain* (SCO membership + `sco.internal.manage` + typed definer gateway). An actor context answers "who is acting", not "for what purpose". Treating operator context as a purpose would directly contradict critical separation J: SCO internal operator access must not be authorization for every SCO purpose. Operator context therefore appears in each Purpose as **Typical Authorized Actors**, never as a purpose of its own.

**"Procurement Operations" and "Procurement Need Intake" — SPLIT, not merged.** Repository evidence forces the split: need-side tables (`procurement_needs`, `procurement_plans`, `procurement_need_approvals`, migration `0009`) carry `company_id` with tenant RLS and are partner-owned, whereas `procurement_cycles` and `procurement_executions` (migration `0010`) had all `sco_runtime` access revoked by migration `0085` and have no tenant path at all. Two different owners, two different authorization bases, one boundary — therefore two purposes.

### D.2 Merges performed

**Commercial Commitment and Payment are one Purpose (PUR-11).** `commercial_commitments` (`0029`) and the payment/funding structures (`0030`, `0031`) share a single objective — establishing and settling the binding commercial obligation arising from an accepted offer — and share the `partner_company_id` ownership key and the same partner-facing summary surface. Splitting them would produce two purposes with identical inputs, identical actors and identical disclosure risk.

**Delivery and Fulfilment are one Purpose (PUR-12)** for the same reason: supplier confirmation, delivery scheduling, tranches, execution and partner receipt/acceptance all serve the single objective of physically satisfying a committed order.

## E. Purpose Taxonomy

Eighteen purposes. Status column uses the labels from section D.

| ID | Purpose | Status | Primary context |
| --- | --- | --- | --- |
| PUR-01 | Identity & Authentication | CURRENTLY IMPLEMENTED | Platform |
| PUR-02 | Authorization & Tenant Administration | CURRENTLY IMPLEMENTED | Company |
| PUR-03 | Partner Relationship Lifecycle | CURRENTLY IMPLEMENTED | SCO operator |
| PUR-04 | Project Context Management | CURRENTLY IMPLEMENTED | Company (partner) |
| PUR-05 | Procurement Need Intake | CURRENTLY IMPLEMENTED | Company (partner) |
| PUR-06 | Procurement Operations | CURRENTLY IMPLEMENTED | SCO operator |
| PUR-07 | SCO Buy-Side Sourcing & Negotiation | CURRENTLY IMPLEMENTED | SCO operator |
| PUR-08 | Internal Supply Network Management | CURRENTLY IMPLEMENTED | SCO operator |
| PUR-09 | Catalog & Product Identity Stewardship | CURRENTLY IMPLEMENTED | Platform / SCO operator |
| PUR-10 | Commercial Pricing (internal) | CURRENTLY IMPLEMENTED | SCO operator |
| PUR-11 | SCO Sell-Side Commercial Offer | CURRENTLY IMPLEMENTED | SCO operator → partner egress |
| PUR-12 | Commercial Commitment & Payment | CURRENTLY IMPLEMENTED | Shared (partner + SCO) |
| PUR-13 | Delivery & Fulfilment | CURRENTLY IMPLEMENTED | Shared (partner + SCO) |
| PUR-14 | Verify (confidential quote verification service) | CURRENTLY IMPLEMENTED | Service boundary |
| PUR-15 | Document Custody & Lifecycle | CURRENTLY IMPLEMENTED | Company / SCO operator |
| PUR-16 | Audit & Security Evidence | CURRENTLY IMPLEMENTED | Cross-cutting |
| PUR-17 | Procurement Intelligence | STRATEGICALLY APPROVED / NOT IMPLEMENTED as a named domain | SCO operator |
| PUR-18 | Studies / Engineering Advisory | STRATEGICALLY APPROVED / NOT IMPLEMENTED | Not established |

Purposes split across the three commercial stages mandated by Strategic Baseline Addendum D: **PUR-05** (partner need) → **PUR-07** (SCO buy-side) → **PUR-11** (SCO sell-side). These are deliberately three purposes, not one procurement pipeline.

## F. Purpose Definitions

### PUR-01 — Identity & Authentication

| Field | Content |
| --- | --- |
| **Business objective** | Establish and maintain who an actor is, and prove it on each request |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | Platform (global identity primitive per 006-A) |
| **Primary data subjects / assets** | `"User"`, `"Session"` |
| **Permitted inputs** | Credentials supplied at login; session token presented per request |
| **Permitted outputs** | An authenticated actor identity (`id`, `email`) to the request pipeline; nothing else |
| **Explicit exclusions** | Identity data is not a commercial dataset; it is not an input to pricing, sourcing, intelligence, or any profiling activity |
| **Typical authorized actors** | The authenticating user; the authentication subsystem |
| **Authorization basis** | Possession of valid credentials, then a valid unexpired unrevoked session bound to an ACTIVE user |
| **Minimum data principle** | Only a SHA-256 token hash is stored; the raw token is never persisted. Downstream purposes receive an actor ID, not a user record |
| **Audit requirement** | Authentication outcomes should be attributable. **Gap:** no dedicated login/logout audit coverage was established (006-A section K item 8) |
| **Cross-purpose entry rules** | No purpose may write identity data; identity is established only by this purpose |
| **Cross-purpose exit rules** | Only the **minimum identity / actor attribution metadata required by the destination purpose** may flow outward — in practice the actor ID, for attribution and authorization (CPF-01). This is not permission to reuse identity or profile data across purposes: email and every other identity attribute remain inside PUR-01 by default |
| **Current enforcement evidence** | `apps/api/src/modules/auth/guards/auth.guard.ts`; `apps/api/src/modules/auth/session.service.ts` (8h absolute / 30m idle, revocation, ACTIVE recheck); `0003_runtime_role_least_privilege` revoking `sco_runtime` mutation on `"User"` |
| **Enforcement gap** | Session audit trail not established |
| **Owner decision dependency** | None |

### PUR-02 — Authorization & Tenant Administration

| Field | Content |
| --- | --- |
| **Business objective** | Determine which company context an actor operates in and what that actor may do inside it |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | Company-owned |
| **Primary data subjects / assets** | `"CompanyMembership"`, `"Role"`, `"MembershipRole"`, `"RolePermission"`, `"Permission"`, the `app.actor_id` / `app.tenant_id` context mechanism |
| **Permitted inputs** | Authenticated actor ID from PUR-01; optional explicit company selection header |
| **Permitted outputs** | A validated tenant context and permission decisions |
| **Explicit exclusions** | **Permission is not entitlement and not cross-purpose authorization.** A permission grants an action inside a purpose; it never licenses export to another purpose. Subscription/entitlement is NOT IMPLEMENTED and must not be modelled as `Permission` |
| **Typical authorized actors** | The platform itself; administration surface NOT ENOUGH EVIDENCE (no role-management endpoint found) |
| **Authorization basis** | ACTIVE membership in an ACTIVE company, validated server-side; client-supplied identifiers are never authorization |
| **Minimum data principle** | Guards resolve a membership ID, company ID and a boolean permission result — not a role catalogue |
| **Audit requirement** | Authorization denials and membership resolution failures should be attributable. **Gap:** no RBAC-change history |
| **Cross-purpose entry rules** | No operational purpose may mutate RBAC as a side effect of its own activity |
| **Cross-purpose exit rules** | Only the **authorization decision and context metadata necessary to evaluate or evidence an access** may flow outward — the validated tenant context and the permission decision itself (CPF-02). Authorization data never constitutes cross-purpose permission, and membership/role graphs do not flow |
| **Current enforcement evidence** | `tenant.guard.ts`; `memberships.service.ts` (ambiguous multi-membership rejected, not guessed); `permission.guard.ts`; `permissions.service.ts`; FORCE RLS tenant policies in `0004_rbac_audit_documents`; `apps/api/test/database/postgres-rls.integration.test.ts` |
| **Enforcement gap** | No purpose dimension exists in the authorization model; permissions are purpose-blind |
| **Owner decision dependency** | None for 006-B |

### PUR-03 — Partner Relationship Lifecycle

| Field | Content |
| --- | --- |
| **Business objective** | Qualify organizations and establish/maintain the partnership relationship that makes procurement partnership possible |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | SCO operator |
| **Primary data subjects / assets** | `qualification_applications`, `company_partnerships`, `"Company"` directory entries |
| **Permitted inputs** | Applicant-provided qualification data; SCO review decisions |
| **Permitted outputs** | An ACTIVE partnership of a declared type, enabling downstream purposes |
| **Explicit exclusions** | Qualification data is not a commercial dataset and is not an input to pricing or intelligence. Relationship status is not permission and is not entitlement |
| **Typical authorized actors** | SCO staff holding `qualification.manage` / `partnership.manage` |
| **Authorization basis** | SCO operator context plus explicit capability |
| **Minimum data principle** | Legal name and contact email at application; decision metadata at review |
| **Audit requirement** | Decisions recorded with reviewer, timestamp and reason |
| **Cross-purpose entry rules** | No tenant path exists into qualification data — migration `0085` revoked all `sco_runtime` access |
| **Cross-purpose exit rules** | Partnership *existence and type* may be consumed by PUR-05 and PUR-08 (CPF-03, CPF-04). Qualification *content* may not |
| **Current enforcement evidence** | `0085_internal_gateway_security_remediation` (REVOKE ALL on `qualification_applications` from `sco_runtime`; `partnership_active_tenant` replacing the GUC-bypass policy); `qualification.controller.ts` behind `ScoInternalGuard` |
| **Enforcement gap** | Partnership *creation and activation* are fully gated. However, consumption of partnership status by downstream intake is not: see CPF-03 |
| **Owner decision dependency** | None |

### PUR-04 — Project Context Management

| Field | Content |
| --- | --- |
| **Business objective** | Let a partner organize its demand and work under a project context |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | Company-owned (partner) |
| **Primary data subjects / assets** | `projects`, `project_members`, `project_member_disciplines`, `company_disciplines` |
| **Permitted inputs** | Partner-supplied project definition; project membership derived from `company_membership_id` |
| **Permitted outputs** | Project context attached to demand and operational records |
| **Explicit exclusions** | **Project context is not unrestricted commercial reuse.** Project identity and site/location context are partner-identifying and are excluded from every egress and from intelligence by default |
| **Typical authorized actors** | Tenant users of the owning company |
| **Authorization basis** | Tenant context (ACTIVE membership in the owning company) |
| **Minimum data principle** | Downstream purposes receive `project_id` as a context key; `location_context`, project name and description are not required downstream |
| **Audit requirement** | Project lifecycle changes attributable via `audit_logs` |
| **Cross-purpose entry rules** | Project context is secondary to company context (006-A); a project never widens a tenant boundary |
| **Cross-purpose exit rules** | `project_id` may flow to PUR-05/PUR-06 (CPF-05). Project identity must not flow to partner-external surfaces or to PUR-17 without an Owner decision (CPF-36) |
| **Current enforcement evidence** | `0009_rolling_planning` (`projects_tenant`, `project_members_tenant`, FORCE RLS); `0085` granting only a read-only `projects_gateway_owner` SELECT policy |
| **Enforcement gap** | No project-level permission checks in the application layer; no project CRUD surface found |
| **Owner decision dependency** | FOG-1 where project-identifiable data is proposed as intelligence input |

### PUR-05 — Procurement Need Intake

| Field | Content |
| --- | --- |
| **Business objective** | Turn a partner's requirement into a structured, processable procurement need |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | Company-owned (partner) |
| **Primary data subjects / assets** | `procurement_needs`, `procurement_plans`, `procurement_plan_items`, `procurement_need_approvals`, `procurement_need_history`, `procurement_documents`, `procurement_document_lines` |
| **Permitted inputs** | Partner-entered demand; extracted document lines (CPF-18); catalog product identity (CPF-17); project context (CPF-05) |
| **Permitted outputs** | Approved, READY demand available to PUR-06 (CPF-06) |
| **Explicit exclusions** | Need intake receives no supplier identity, no purchase source, no buy-side cost, and no Verify data |
| **Typical authorized actors** | Tenant users of the owning partner company |
| **Authorization basis** | Tenant context; need maturity/review transitions recorded |
| **Minimum data principle** | Product identity or description, quantity, unit, need date, maturity. Partner commercial intent beyond this is not required |
| **Audit requirement** | Maturity and quantity transitions recorded in `procurement_need_history`; document actions in `audit_logs` |
| **Cross-purpose entry rules** | Only partner-owned and catalog data may enter |
| **Cross-purpose exit rules** | Demand facts may flow to PUR-06. Partner identity accompanies the need internally but must not egress to suppliers (CPF-31) |
| **Current enforcement evidence** | `0009_rolling_planning` tenant policies; `0008_procurement_document_extraction`; `procurement-documents.service.ts` |
| **Enforcement gap** | Two recorded gaps: (a) `POST /api/v1/procurement-documents/:id/extract` carries `AuthGuard` + `TenantGuard` but no `@RequirePermission` (006-A section K item 9); (b) need creation does not require an ACTIVE `CompanyPartnership` — see CPF-03 |
| **Owner decision dependency** | None |

### PUR-06 — Procurement Operations

| Field | Content |
| --- | --- |
| **Business objective** | Allocate and progress qualified demand through SCO's operational procurement cycle |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | SCO operator; execution items are shared operational records (006-A) |
| **Primary data subjects / assets** | `procurement_cycles`, `procurement_executions`, `procurement_execution_items`, `ready_allocation_events`, `procurement_cycle_exceptions`, `execution_change_requests` |
| **Permitted inputs** | READY needs from PUR-05 (CPF-06); catalog identity |
| **Permitted outputs** | Execution items available to PUR-07 (CPF-07) and to PUR-13; a coarse status projection to the owning partner |
| **Explicit exclusions** | Operations do not disclose sourcing decisions, supplier identity, or cost to the partner |
| **Typical authorized actors** | SCO staff with `execution.manage`; owning partner has read-only status visibility |
| **Authorization basis** | SCO operator context with capability; partner read via tenant policy on the shared records |
| **Minimum data principle** | The partner status projection maps internal statuses to a coarser vocabulary rather than exposing internal state |
| **Audit requirement** | Allocation and change events recorded |
| **Cross-purpose entry rules** | Accepts demand facts only; never Verify data (CPF-23) |
| **Cross-purpose exit rules** | Outputs to PUR-07 must not carry partner identity further than needed for traceability; outputs to the partner are limited to status and quantity |
| **Current enforcement evidence** | `0010_weekly_procurement_execution`; `0085` (REVOKE ALL on `procurement_cycles`/`procurement_executions` from `sco_runtime`; `%I_tenant` retained on the four shared tables); `execution.service.ts` status mapping |
| **Enforcement gap** | None material |
| **Owner decision dependency** | None |

### PUR-07 — SCO Buy-Side Sourcing & Negotiation

| Field | Content |
| --- | --- |
| **Business objective** | Source and negotiate, in SCO's own name, the economically and operationally appropriate supply for allocated demand |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | SCO operator — no tenant path exists |
| **Primary data subjects / assets** | `rfqs`, `rfq_items`, `rfq_recipients`, `supplier_quotes`, `supplier_quote_revisions`, `supplier_quote_items`, `negotiation_sessions`, `negotiation_events`, `alternative_product_proposals`, `approved_purchase_cost_snapshots` |
| **Permitted inputs** | Execution items from PUR-06 (CPF-07); eligible sources from PUR-08 (CPF-08); supplier quote documents (CPF-19) |
| **Permitted outputs** | Approved purchase cost snapshots to PUR-10 (CPF-09) |
| **Explicit exclusions** | **This purpose produces no partner-facing output.** Supplier identity, purchase source, quoted and negotiated cost, negotiation history and alternative-product reasoning are SCO-internal commercial facts. Per Strategic Baseline Addendum D, SCO is not a negotiation agent transmitting supplier terms |
| **Typical authorized actors** | SCO staff with discrete capabilities: `rfq.read`, `quote.read`, `negotiation.read`, `purchase_cost.read`, `source.select`, `purchase_cost.approve`, `purchase_cost.self_approve` |
| **Authorization basis** | SCO operator context plus a capability specific to the sub-activity |
| **Minimum data principle** | Capability separation is already granular: holding `rfq.read` does not yield purchase cost, and holding `purchase_cost.read` does not yield RFQ content |
| **Audit requirement** | Source selection persisted atomically with its audit evidence; negotiation events recorded |
| **Cross-purpose entry rules** | Accepts demand and supply-network facts; accepts no Verify data (CPF-24) |
| **Cross-purpose exit rules** | Cost may flow only to PUR-10. Egress to partner surfaces is DENIED BY DEFAULT (CPF-29, CPF-30) |
| **Current enforcement evidence** | `0013_rfq_quotes_purchase_cost` — note `rfqs` has **no `company_id` column at all**; `0024_source_selection_authorization_audit`; `0085` Section 7. Decisively, `apps/api/test/database/buy-side-trust-boundary.integration.test.ts` proves that across all six runtime spoof combinations (including `app.sco_internal='true'` with a valid `app.actor_id`) every one of fifteen buy-side and source tables rejects `SELECT` with `permission denied` / SQLSTATE `42501`, that known and random UUIDs are denied identically, that capability separation holds, and that partner, supplier and dual-membership actors receive `null` from internal gateways |
| **Enforcement gap** | None material. This is the most strongly enforced boundary in the repository |
| **Owner decision dependency** | FOG-1 if buy-side cost is proposed as intelligence input |

### PUR-08 — Internal Supply Network Management

| Field | Content |
| --- | --- |
| **Business objective** | Maintain SCO's internal commercial and knowledge supply network — suppliers, manufacturers, agents, distributors and pricing sources — and their qualification and capability |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | SCO operator |
| **Primary data subjects / assets** | `purchase_sources`, `purchase_source_type_definitions`, `purchase_source_contacts`, `supplier_qualifications`, `supplier_category_capabilities`, `supplier_network_history`, supplier future demand frameworks |
| **Permitted inputs** | Supplier partnership facts from PUR-03 (CPF-04); SCO qualification decisions |
| **Permitted outputs** | Eligible sources to PUR-07 (CPF-08) |
| **Explicit exclusions** | **This is not a partner-facing supplier directory** (Strategic Baseline Addendum B). No supplier-owned record and no supplier access context exists (006-A section E.11). Supplier identity must not be inferred as partner-disclosable merely because procurement serves the partner |
| **Typical authorized actors** | SCO staff with `supplier.read`, `supplier.qualify`, `purchase_source.create` |
| **Authorization basis** | SCO operator context plus capability |
| **Minimum data principle** | PUR-07 receives source eligibility, not the full supplier record |
| **Audit requirement** | Network changes recorded in `supplier_network_history` plus `audit_logs` |
| **Cross-purpose entry rules** | Partner identity and project identity must not enter supplier-facing context (CPF-31) |
| **Cross-purpose exit rules** | Supplier identity egress to partner surfaces is DENIED BY DEFAULT (CPF-30) |
| **Current enforcement evidence** | `0011_supplier_network`; `0085` Section 7 revoking all `sco_runtime` access to six supply-network tables and stating they "remain SCO-internal commercial facts"; `supplier-po-scoped-visibility.integration.test.ts` requiring both read permission and a valid source/category assignment, and preventing direct table reads for runtime and executor roles |
| **Enforcement gap** | No supplier access context exists at all, so no supplier-side minimization rules are implemented (none are currently needed) |
| **Owner decision dependency** | FOG-5 if suppliers ever become an access context |

### PUR-09 — Catalog & Product Identity Stewardship

| Field | Content |
| --- | --- |
| **Business objective** | Maintain a shared, neutral vocabulary of product identity, categories, attributes, units and currencies |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | Platform reference data stewarded by SCO operators |
| **Primary data subjects / assets** | `product_categories`, `category_attribute_definitions`, `product_identities`, `product_attribute_values`, `unit_definitions`, `currency_definitions`, `product_candidates`, `product_match_assessments`, `product_candidate_history` |
| **Permitted inputs** | Partner-submitted candidates (tenant-scoped); SCO stewardship decisions |
| **Permitted outputs** | **Global catalog identity only** — canonical product reference data (`product_identities` in ACTIVE status, `product_categories`, `category_attribute_definitions`, `product_attribute_values` for activated identities, `unit_definitions`, `currency_definitions`) readable as neutral reference data by operational purposes that need to name a product, unit or currency (CPF-17) |
| **Explicit exclusions** | The reusable layer is the canonical reference vocabulary only. **Candidate content** (`product_candidates`, `product_match_assessments`, `product_candidate_history`, including `submitted_specification`, `source_metadata` and the submitting `company_id`) is tenant-scoped and is **not** globally reusable. Supplier-specific content, sourcing data, commercial data and partner-specific data do **not** become globally reusable merely because they relate to a catalog entry. Catalog output must be neutral and must not carry the submitting partner's identity into the global vocabulary |
| **Typical authorized actors** | SCO staff with `catalog.manage`, `catalog.approve`, `candidate.manage`; tenant users may submit and list their own candidates |
| **Authorization basis** | Tenant context for submission; SCO operator context plus capability for stewardship |
| **Minimum data principle** | Public specification is public; submitted specification remains candidate-scoped |
| **Audit requirement** | Candidate transitions recorded in `product_candidate_history` |
| **Cross-purpose entry rules** | Candidate review legitimately spans companies, but after `0085` that is a gateway-owner privilege, not a `sco_runtime` GUC bypass |
| **Cross-purpose exit rules** | Canonical catalog identity flows as neutral reference data to purposes that need to name a product, unit or currency (CPF-17). Candidate content does not flow at all |
| **Current enforcement evidence** | `0006_global_product_catalog`; `0085` Sections 2–3 narrowing `product_candidate_scope`, `match_assessment_scope`, `candidate_history_scope` to `company_id` only |
| **Enforcement gap** | None material |
| **Owner decision dependency** | None |

### PUR-10 — Commercial Pricing (internal)

| Field | Content |
| --- | --- |
| **Business objective** | Establish SCO's own selling price, margin and overhead position from its buy-side cost basis |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | SCO operator |
| **Primary data subjects / assets** | `pricing_cases`, `pricing_revisions`, `pricing_lines`, `pricing_cost_allocations`, direct deal costs, FX snapshots |
| **Permitted inputs** | Approved purchase cost snapshots from PUR-07 (CPF-09) |
| **Permitted outputs** | A priced revision bound to an offer revision in PUR-11 (CPF-10) |
| **Explicit exclusions** | **Cost basis, gross margin, overhead, contribution and cost allocations never egress to the partner.** Verify data is not a pricing input (CPF-24) |
| **Typical authorized actors** | SCO staff with pricing capabilities and separate approval capability |
| **Authorization basis** | SCO operator context plus capability; separation of duties on approval |
| **Minimum data principle** | PUR-11 receives selling totals and tax treatment, not the cost derivation behind them |
| **Audit requirement** | Pricing decisions and loss approvals audited (`pricing.direct_loss_approved` and related actions) |
| **Cross-purpose entry rules** | Only buy-side cost and catalog identity may enter |
| **Cross-purpose exit rules** | Only selling-side figures may cross into PUR-11; everything upstream stops here |
| **Current enforcement evidence** | `0026_commercial_pricing_foundation`; `offer_internal_bindings` in `0028` keeping the pricing link on the internal side; `batch-8-commercial-confidentiality.integration.test.ts` |
| **Enforcement gap** | None material |
| **Owner decision dependency** | FOG-2 if intelligence output is ever proposed as a pricing input |

### PUR-11 — SCO Sell-Side Commercial Offer

| Field | Content |
| --- | --- |
| **Business objective** | Present SCO's own sale offer to the partner, which the partner accepts or rejects |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | SCO operator authors; partner is the addressed counterparty (006-A) |
| **Primary data subjects / assets** | `partner_offers`, `partner_offer_revisions`, `partner_offer_lines`, `offer_approvals`, `offer_internal_bindings` |
| **Permitted inputs** | Priced revisions from PUR-10 (CPF-10) |
| **Permitted outputs** | A minimized partner-facing offer projection; acceptance into PUR-12 (CPF-12) |
| **Explicit exclusions** | The partner-facing projection must not contain pricing derivation, purchase cost, supplier identity, purchase source, margin, overhead, contribution, or internal approval reasoning |
| **Typical authorized actors** | SCO staff with `offer.create`, `offer.approve`, `offer.issue`, `offer.withdraw`; partner users with `offer.partner_read` and `offer.accept` |
| **Authorization basis** | SCO operator context plus capability for authorship; partner tenant context plus offer capability for read/accept |
| **Minimum data principle** | The projection discloses exactly: offer and revision identifiers, revision number, status, currency, validity, totals excluding/including tax, tax amount, commercial/payment/delivery terms, and per-line product identity, description, quantity, unit, unit selling price, tax treatment, tax amount and line total |
| **Audit requirement** | Creation, submission, decision, issue, withdrawal and acceptance all audited; acceptance recorded under TENANT scope |
| **Cross-purpose entry rules** | Only PUR-10 output may enter. Verify data may not (CPF-25) |
| **Cross-purpose exit rules** | Egress is limited to the projection above; `offer_internal_bindings` stays internal |
| **Current enforcement evidence** | `0028_partner_offer_revisions`: `partner_offer_projection` requires `app.tenant_id = p_company` and `offer.partner_read`, and selects only the allowlisted fields; `internal_offer_decide` raises `OFFER_SEPARATION_OF_DUTIES_REQUIRED` when approver equals creator; `partner-offer-revisions.integration.test.ts:161` asserts the projection does **not** match `/pricing\|purchase\|supplier\|source\|margin\|overhead\|contribution\|approvalReason/i` |
| **Enforcement gap** | None material. This is a positively tested non-disclosure boundary |
| **Owner decision dependency** | None |

### PUR-12 — Commercial Commitment & Payment

| Field | Content |
| --- | --- |
| **Business objective** | Establish and settle the binding obligation arising from an accepted offer |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | Shared — `commercial_commitments` is a shared operational record (006-A) |
| **Primary data subjects / assets** | `partner_purchase_orders`, `commercial_commitments`, payment requirements and receipts, funding requirements, cash funding evaluations, supplier payment schedules |
| **Permitted inputs** | Accepted offer revision from PUR-11 (CPF-12) |
| **Permitted outputs** | Release authority into PUR-13; a partner-facing payment summary |
| **Explicit exclusions** | Supplier payment schedules and SCO funding/cash-exposure positions are internal and do not egress to the partner |
| **Typical authorized actors** | Partner users for PO submission and payment receipt recording; SCO staff for verification, funding and supplier-side schedules |
| **Authorization basis** | Partner tenant context plus capability; SCO operator context plus capability |
| **Minimum data principle** | Partner summary covers the partner's own obligation, not SCO's supplier-side cash position |
| **Audit requirement** | Commitment creation, payment verification and funding evaluation audited |
| **Cross-purpose entry rules** | Only an accepted PUR-11 revision creates a commitment |
| **Cross-purpose exit rules** | Supplier-side payment data must not reach partner surfaces |
| **Current enforcement evidence** | `0029_partner_po_commercial_commitment`; `0030_payments_funding_foundation`; `0031_cash_funding_evaluation_status_fix`; `0056` payment-schedule immutability |
| **Enforcement gap** | None material |
| **Owner decision dependency** | None |

### PUR-13 — Delivery & Fulfilment

| Field | Content |
| --- | --- |
| **Business objective** | Physically satisfy a committed order and record receipt, acceptance and discrepancy |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | Shared — SCO operates supplier-side execution; the partner owns receipt and acceptance |
| **Primary data subjects / assets** | `supplier_purchase_orders`, PO confirmation events, delivery tranches, delivery execution events, partner receipt/acceptance/discrepancy records, warranty entitlement records |
| **Permitted inputs** | Releases and commitments from PUR-06/PUR-12 |
| **Permitted outputs** | Partner-facing delivery projection, warranty entitlement list; internal fulfilment state |
| **Explicit exclusions** | Supplier PO identity, supplier confirmation references and supplier-side scheduling are internal; the partner projection conveys delivery status against the partner's own commitment |
| **Typical authorized actors** | SCO procurement staff with scoped assignment; partner users with delivery capabilities |
| **Authorization basis** | SCO operator context plus capability plus valid source/category assignment; partner tenant context plus capability plus `partner_delivery_execution_owned` ownership check |
| **Minimum data principle** | Partner receives what is needed to confirm receipt and raise discrepancy |
| **Audit requirement** | Delivery events immutable; update and delete rejected even for the database owner |
| **Cross-purpose entry rules** | Accepts commitment and release facts |
| **Cross-purpose exit rules** | Supplier identity does not egress (CPF-30) |
| **Current enforcement evidence** | `0038_supplier_purchase_order_core`; `0060_partner_supplier_delivery_projections`; `0072_physical_delivery_execution_foundation`; `0073_partner_delivery_receipt_acceptance_discrepancy`; `0076_warranty_entitlement_foundation`; `supplier-delivery-execution.integration.test.ts` (owner-level immutability); `warranty-entitlement-foundation.integration.test.ts` asserting `storage_key` is absent from the projection |
| **Enforcement gap** | None material |
| **Owner decision dependency** | None |

### PUR-14 — Verify (confidential quote verification service)

| Field | Content |
| --- | --- |
| **Business objective** | Provide a confidential, methodology-bound verification of a partner-submitted quote, independent of SCO's procurement and commercial activity |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | Independent service boundary; partner owns the input, SCO operates the processing |
| **Primary data subjects / assets** | `verify_requests`, `verify_quote_revisions`, `verify_quote_lines` and adjustments, `verify_runs`, `verify_evidence_bindings`, `verify_run_line_scope`, `verify_line_results`, `verify_line_result_evidence`, `verify_results`, `verify_raw_review_grants`, `verify_raw_content_access_events` |
| **Permitted inputs** | Partner-submitted quote content and raw document (same company, trigger-enforced); evidence/reference material bound to a run; catalog identity |
| **Permitted outputs** | **Exactly one** partner-facing projection: request/revision/run/result identifiers, status, classification, finalized timestamp, and per-currency coverage counts and percentages |
| **Explicit exclusions** | No Verify output flows to procurement, pricing, offers, intelligence, sales or supplier workflows. Raw partner quote content is inaccessible to humans by default. Confidence context, variance data, exclusions/limitations, evidence identifiers and internal workflow metadata are not partner-disclosed by the current projection |
| **Typical authorized actors** | Partner users with `partner_verify.write` / `partner_verify.read`; SCO staff with `verify.analyst` / `verify.approver`; a fixed SYSTEM actor for run execution |
| **Authorization basis** | For partner read: ACTIVE membership in an ACTIVE `type='PARTNER'` company holding `partner_verify.read`, plus a GUC cross-check. For raw content: partner consent **and** an internally authorized, purpose-specific, scope-specific, time-limited grant with an approver distinct from the actor |
| **Minimum data principle** | The partner DTO is an explicit allowlist in two independent layers — the SQL gateway selects only permitted columns, and the service maps only named fields |
| **Audit requirement** | Lifecycle transitions, finalization, supersession and every raw-content access event audited; access events immutable |
| **Cross-purpose entry rules** | Documents may enter only from the same company (CPF-20). No procurement, supplier or commercial data enters Verify |
| **Cross-purpose exit rules** | Only CPF-22 is permitted. CPF-23 … CPF-28 are DENIED BY DEFAULT |
| **Current enforcement evidence** | `0082_verify_foundation` (FORCE RLS on the 10 Verify tables it introduces, `REVOKE ALL … FROM PUBLIC, sco_runtime, sco_internal_executor`, immutability triggers, raw-review grant constraints); `0083` lifecycle; `0084` SYSTEM actor without caller-supplied actor parameter, one-result-per-run, immutable run scope, plus 3 further Verify-related tables under the same FORCE RLS and revocation treatment — **10 (`0082`) + 3 (`0084`) = 13 current Verify-related tables**; `0086` dedicated `sco_verify_partner_read_owner` SELECT-only role with seven tenant `FOR SELECT` policies and fail-closed `candidate_count <> 1` logic; `partner-verify-result.integration.test.ts` asserting the DTO keys are exactly `classification, coverage, finalizedAt, requestId, resultId, revisionId, runId, status`, that no confidential pattern appears, that the gateway definition contains no `INSERT`/`UPDATE`/`DELETE`, and that the definition does not reference `storage_key`/raw-content access |
| **Enforcement gap** | Verify's isolation is enforced by the *absence* of any connecting code path plus strict table-level revocation, not by a purpose-aware mechanism that would reject a future connection attempt |
| **Owner decision dependency** | None to establish the current boundary — Verify secondary use is already DENIED BY DEFAULT under the approved rule. FOG-4 applies only to a future *exception* permitting Verify reuse beyond the partner result |

### PUR-15 — Document Custody & Lifecycle

| Field | Content |
| --- | --- |
| **Business objective** | Hold, version and protect files used by operational purposes. **PUR-15 is custody and lifecycle responsibility over the Document *asset*; it is not a universal authorization to use document *content*, which remains bound to the purpose that consumes it** |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | Company-owned, partitioned by `access_scope` |
| **Primary data subjects / assets** | `documents`, `document_versions`, `procurement_documents`, `supplier_quote_documents`, `supplier_po_commercial_documents` |
| **Permitted inputs** | Uploaded content with computed size and SHA-256 |
| **Permitted outputs** | Content released only to a purpose authorized for that document |
| **Explicit exclusions** | **A document is an asset, not a purpose.** Availability for one purpose does not make it reusable for another. `storage_key` is never disclosed to a client |
| **Typical authorized actors** | Tenant users for `access_scope='TENANT'` documents; SCO staff with `quote.document.read` for supplier quote documents |
| **Authorization basis** | Tenant context, or SCO operator context plus document capability through a SECURITY DEFINER gateway |
| **Minimum data principle** | Metadata responses return filename, MIME type and size only |
| **Audit requirement** | Document actions audited; Verify raw-content opens audited immutably |
| **Cross-purpose entry rules** | Documents enter a purpose by explicit reference with a same-company constraint where the destination enforces one |
| **Cross-purpose exit rules** | CPF-18, CPF-19, CPF-20 are the permitted document flows; CPF-21 is not implemented. Verify raw content may not flow anywhere else (CPF-28) |
| **Current enforcement evidence** | `0004_rbac_audit_documents`; `0020_supplier_quote_document_access_isolation` (`access_scope`, `get_supplier_quote_document` requiring SCO membership plus `quote.document.read`, EXECUTE only to `sco_internal_executor`); `0082` triggers `verify_quote_revision_document_valid` / `verify_evidence_document_valid` rejecting cross-company documents; `storage-provider.ts` restricting local storage to development/test |
| **Enforcement gap** | NOT IMPLEMENTED: watermarking, export controls, expiring access, retention and disposal (006-A section E.5) |
| **Owner decision dependency** | FOG-6 (retention/disposal policy remains pending per the Verify architecture document) |

### PUR-16 — Audit & Security Evidence

| Field | Content |
| --- | --- |
| **Business objective** | Provide accountability, traceability and security evidence. **PUR-16 is special-purpose evidentiary and security processing that spans domains; it is not an ordinary commercial-purpose dataset and it authorizes no commercial reuse** |
| **Status** | CURRENTLY IMPLEMENTED PURPOSE |
| **Primary organizational context** | Cross-cutting, partitioned by `AuditScope` |
| **Primary data subjects / assets** | `audit_logs`; domain history tables; Verify raw-content access events |
| **Permitted inputs** | Attributable events from every purpose (CPF-41) |
| **Permitted outputs** | Evidence for accountability, investigation and compliance |
| **Explicit exclusions** | **Audit and security evidence is not an ordinary commercial data source.** It must not become a behavioural dataset, a pricing input, a sourcing input, or an intelligence input (CPF-32). Secrets are filtered from metadata |
| **Typical authorized actors** | Security and accountability functions. NOT ENOUGH EVIDENCE of a general audit-query surface |
| **Authorization basis** | Tenant context for TENANT scope; system/internal paths for other scopes |
| **Minimum data principle** | Metadata keys matching `password\|token\|secret\|credential\|authorization\|cookie` are stripped before insert |
| **Audit requirement** | This purpose is the audit requirement; records are append-only in practice |
| **Cross-purpose entry rules** | All purposes must write audit evidence; writing audit is never optional |
| **Cross-purpose exit rules** | Commercial reuse DENIED BY DEFAULT |
| **Current enforcement evidence** | `0004_rbac_audit_documents` (`audit_tenant`, `audit_system_insert` requiring `scope <> 'TENANT'` and `app.audit_system`, CHECK binding TENANT scope to a company); `audit.service.ts` metadata filtering and `TENANT_AUDIT_CONTEXT_REQUIRED` |
| **Enforcement gap** | Append-only behaviour for `audit_logs` is by grant and convention (`GRANT SELECT, INSERT`), not by an UPDATE/DELETE-rejecting trigger as used for Verify history |
| **Owner decision dependency** | None unless commercial reuse is proposed |

### PUR-17 — Procurement Intelligence

| Field | Content |
| --- | --- |
| **Business objective** | Derive aggregate purchasing insight to improve SCO's sourcing and commercial position |
| **Status** | STRATEGICALLY APPROVED PURPOSE; **NOT IMPLEMENTED as a named independent domain**. Buying-power capability exists and is the only implemented precursor |
| **Primary organizational context** | SCO operator |
| **Primary data subjects / assets (current precursor only)** | `buying_power_snapshots`, `buying_power_snapshot_lines`, `buying_power_snapshot_source_memberships`, `buying_power_aggregation_runs` |
| **Permitted inputs** | **Currently implemented:** committed, potential, qualified, open, released and procured quantities derived from needs, execution items and commitment lines, aggregated per `product_identity_id` + `unit_id`. **Anything beyond this is OWNER DECISION REQUIRED** |
| **Permitted outputs** | Internal aggregate summaries and lineage for SCO operators only |
| **Explicit exclusions** | Verify data is excluded by default (CPF-26). Audit/security evidence is excluded (CPF-32). Partner-identifiable and project-identifiable data must not become intelligence input merely because SCO stores it (CPF-36). No partner-facing intelligence output exists |
| **Typical authorized actors** | SCO staff invoking `internal_buying_power_*` gateways |
| **Authorization basis** | SCO operator context plus capability |
| **Minimum data principle** | **Load-bearing current fact:** `buying_power_snapshot_lines` is keyed by `(snapshot_id, product_identity_id, unit_id)` and carries **no `company_id` and no `project_id`** — the aggregate output layer is already non-identifiable by construction. By contrast `buying_power_snapshot_source_memberships` retains `source_type` and source identifiers, so **lineage remains identifiable** and must stay internal |
| **Audit requirement** | Aggregation runs are recorded with publisher, cutoff and source fingerprint |
| **Cross-purpose entry rules** | Operational procurement history may enter in aggregate form (CPF-33). Broader PI inputs require an Owner decision (CPF-34, CPF-35, CPF-36) |
| **Cross-purpose exit rules** | Any PI feedback into sourcing or pricing requires an Owner decision (CPF-37, CPF-38). No partner egress |
| **Current enforcement evidence** | `0061_buying_power_foundation`; `0065`–`0071` classification, rolling window, procured metrics and views; `buying-power-foundation.integration.test.ts`; `buying-power-views.integration.test.ts` |
| **Enforcement gap** | No purpose mechanism distinguishes "operational use" from "intelligence use" of the same operational records; the distinction is currently organizational, not technical |
| **Owner decision dependency** | FOG-1, FOG-2 |

### PUR-18 — Studies / Engineering Advisory

| Field | Content |
| --- | --- |
| **Business objective** | Deliver engineering/study work as a supporting capability around the procurement partnership |
| **Status** | STRATEGICALLY APPROVED PURPOSE; **FUTURE / NOT IMPLEMENTED** |
| **Primary organizational context** | Not established |
| **Primary data subjects / assets** | None. A repository-wide search for `study`/`studies`/engineering-study terminology across `apps/api/src`, `prisma/migrations`, `test` and `docs` returns **no match** |
| **Permitted inputs / outputs** | NOT ENOUGH EVIDENCE — to be defined when the purpose is implemented |
| **Explicit exclusions** | Defined pre-emptively so later work cannot assume otherwise: study data does not automatically become procurement input, and does not automatically become intelligence input (CPF-39, CPF-40) |
| **Typical authorized actors** | NOT ENOUGH EVIDENCE |
| **Authorization basis** | NOT ENOUGH EVIDENCE |
| **Minimum data principle** | Cannot be defined without a product decision |
| **Audit requirement** | Will inherit PUR-16 obligations |
| **Cross-purpose entry/exit rules** | All flows NOT IMPLEMENTED; none are authorized by this contract |
| **Current enforcement evidence** | None. `projects` (PUR-04) is the nearest existing primitive and is a demand-organization context, not a studies domain |
| **Enforcement gap** | Entire purpose unimplemented |
| **Owner decision dependency** | FOG-3 |

## G. Cross-Purpose Flow Contract

### G.1 Rules binding every flow

1. **Six-element rule.** A flow must declare source, destination, purpose, minimum data, authorization basis and audit requirement. Missing any element ⇒ DENIED BY DEFAULT.
2. **Derivation inherits constraint.** Data derived from a source purpose carries that purpose's constraints. Transformation, summarisation or re-storage does not launder a purpose boundary.
3. **Aggregation mitigates, it does not authorize.** Removing identifiers may reduce risk but never by itself creates authority for a flow.
4. **Egress is narrower than access.** Reaching data inside a purpose does not permit disclosing it outside the organizational context holding it.
5. **Lineage is data.** A link back to an identifiable partner, project or supplier is itself identifiable data and is governed by the same rules as the fields it points to.
6. **Technical possibility is not policy.** A flow is ALLOWED only when this contract says so.
7. **Absence is not enforcement.** Where a denied flow has no code path, the denial is recorded as policy with enforcement gap noted.

### G.2 Status definitions

| Policy Status | Meaning |
| --- | --- |
| `ALLOWED` | Permitted by this contract within the stated minimum data and authorization basis |
| `DENIED BY DEFAULT` | Not permitted; may only change through an explicit Owner decision |
| `OWNER DECISION REQUIRED` | Business value may exist but the authorization basis is not settled by the Strategic Baseline |
| `NOT IMPLEMENTED` | Neither endpoint is implemented; nothing is authorized |

## H. Cross-Purpose Flow Matrix

### H.1 Compact matrix

41 flows. "Enforcement" reports current technical reality, independent of policy.

| ID | Source → Destination | Policy Status | Current Technical Enforcement |
| --- | --- | --- | --- |
| CPF-01 | PUR-01 Identity → all purposes (minimum actor attribution only) | ALLOWED | ENFORCED (actor ID only via `app.actor_id`) |
| CPF-02 | PUR-02 Authorization → all purposes (decision/context metadata only) | ALLOWED | ENFORCED (guards + RLS) |
| CPF-03 | PUR-03 Partner Relationship → PUR-05 Need Intake | ALLOWED | **PARTIALLY ENFORCED** — tenant/company context enforced; ACTIVE `CompanyPartnership` **not** enforced as an intake prerequisite |
| CPF-04 | PUR-03 Partner Relationship → PUR-08 Supply Network | ALLOWED | ENFORCED (supplier partnership key) |
| CPF-05 | PUR-04 Project → PUR-05 Need Intake | ALLOWED | ENFORCED (tenant RLS, same company) |
| CPF-06 | PUR-05 Need Intake → PUR-06 Operations | ALLOWED | ENFORCED (gateway + eligibility rules) |
| CPF-07 | PUR-06 Operations → PUR-07 Buy-Side Sourcing | ALLOWED | ENFORCED (internal gateways only) |
| CPF-08 | PUR-08 Supply Network → PUR-07 Buy-Side Sourcing | ALLOWED | ENFORCED (capability-gated gateway) |
| CPF-09 | PUR-07 Buy-Side → PUR-10 Pricing | ALLOWED | ENFORCED (snapshot binding) |
| CPF-10 | PUR-10 Pricing → PUR-11 Offer | ALLOWED | ENFORCED (`offer_internal_bindings`) |
| CPF-11 | PUR-11 Offer → partner egress | ALLOWED (minimized) | ENFORCED (allowlisted projection + test) |
| CPF-12 | PUR-11 Offer acceptance → PUR-12 Commitment | ALLOWED | ENFORCED (gateway + status/validity checks) |
| CPF-13 | PUR-06 Operations → PUR-13 Delivery | ALLOWED | ENFORCED |
| CPF-14 | PUR-12 Commitment → PUR-13 Delivery | ALLOWED | ENFORCED (release path) |
| CPF-15 | PUR-13 Delivery → partner egress | ALLOWED (minimized) | ENFORCED (ownership-checked projection) |
| CPF-16 | PUR-12 Payment → partner egress | ALLOWED (minimized) | ENFORCED (tenant-checked summary) |
| CPF-17 | PUR-09 Catalog → purposes needing canonical product/unit/currency reference | ALLOWED (canonical reference data only) | ENFORCED (global read limited to neutral reference tables; candidate content stays tenant-scoped) |
| CPF-18 | PUR-15 Documents → PUR-05 Need Intake | ALLOWED | ENFORCED (tenant RLS) |
| CPF-19 | PUR-15 Documents → PUR-07 Buy-Side | ALLOWED | ENFORCED (`SCO_INTERNAL` scope + capability) |
| CPF-20 | PUR-15 Documents → PUR-14 Verify | ALLOWED | ENFORCED (same-company triggers) |
| CPF-21 | PUR-15 Documents → PUR-18 Studies | NOT IMPLEMENTED | n/a |
| CPF-22 | PUR-14 Verify → partner Verify result | ALLOWED (minimized) | ENFORCED (two-layer allowlist, fail-closed) |
| CPF-23 | PUR-14 Verify → PUR-06 Procurement | DENIED BY DEFAULT | NOT ENFORCED (no code path exists) |
| CPF-24 | PUR-14 Verify → PUR-10 Pricing | DENIED BY DEFAULT | NOT ENFORCED (no code path exists) |
| CPF-25 | PUR-14 Verify → PUR-11 Offer | DENIED BY DEFAULT | NOT ENFORCED (no code path exists) |
| CPF-26 | PUR-14 Verify → PUR-17 Intelligence | DENIED BY DEFAULT | NOT ENFORCED (no code path exists) |
| CPF-27 | PUR-14 Verify → PUR-08 Supply Network / supplier workflow | DENIED BY DEFAULT | NOT ENFORCED (no code path exists) |
| CPF-28 | Verify raw content → any non-Verify purpose | DENIED BY DEFAULT | PARTIALLY ENFORCED (grant + consent model; no raw delivery implemented) |
| CPF-29 | PUR-07 buy-side cost → partner egress | DENIED BY DEFAULT | ENFORCED (projection allowlist + negative test) |
| CPF-30 | PUR-08 supplier/source identity → partner egress | DENIED BY DEFAULT | ENFORCED (revocation + projection allowlist + tests) |
| CPF-31 | Partner/project identity → supplier-facing context | DENIED BY DEFAULT | NOT ENFORCED (no supplier context exists) |
| CPF-32 | PUR-16 Audit evidence → commercial purposes | DENIED BY DEFAULT | NOT ENFORCED (no code path exists) |
| CPF-33 | Operational procurement history → buying-power aggregation | ALLOWED (aggregate, non-identifiable output) | ENFORCED (aggregation keyed by product/unit only) |
| CPF-34 | Operational procurement history → PUR-17 beyond buying power | OWNER DECISION REQUIRED | NOT ENFORCED |
| CPF-35 | Buy-side cost / supplier performance → PUR-17 | OWNER DECISION REQUIRED | NOT ENFORCED |
| CPF-36 | Partner/project-identifiable data → PUR-17 | OWNER DECISION REQUIRED | NOT ENFORCED |
| CPF-37 | PUR-17 → PUR-07 Buy-Side (feedback) | OWNER DECISION REQUIRED | NOT ENFORCED |
| CPF-38 | PUR-17 → PUR-10 Pricing (feedback) | OWNER DECISION REQUIRED | NOT ENFORCED |
| CPF-39 | PUR-18 Studies → PUR-05/PUR-06 Procurement | NOT IMPLEMENTED | n/a |
| CPF-40 | PUR-18 Studies → PUR-17 Intelligence | NOT IMPLEMENTED | n/a |
| CPF-41 | All purposes → PUR-16 Audit | ALLOWED (mandatory) | PARTIALLY ENFORCED (write paths exist; coverage uneven) |

**Status counts:** ALLOWED 23 · DENIED BY DEFAULT 10 · OWNER DECISION REQUIRED 5 · NOT IMPLEMENTED 3 · total 41.

The five `OWNER DECISION REQUIRED` flows are **not blockers to closing 006-B**. Each marks a flow that may not be *built* until the corresponding future gate in section P.2 is passed; the contract itself is complete without them.

### H.2 Detailed flow entries (material flows)

Only flows whose detail is not fully conveyed above are expanded.

#### CPF-03 — Partner Relationship → Procurement Need Intake

- **Business reason:** procurement partnership is the core relationship; an onboarded partner expresses demand.
- **Minimum data:** the existence and type of an ACTIVE partnership for the acting company. Qualification content never flows.
- **Prohibited data:** qualification application content, reviewer identity, decision reasoning.
- **Authorization basis (contractual):** ACTIVE membership in an ACTIVE company **and** an ACTIVE `CompanyPartnership` of the appropriate type for that company.
- **Audit requirement:** need creation attributable to actor and company.
- **Current implementation evidence:** `PlanningService.createNeed` (`apps/api/src/modules/identity/planning.service.ts`) validates quantity and then writes `procurement_needs` inside `withTenant(ctx.userId, ctx.companyId, …)`, so the company context is server-derived and tenant RLS applies. It performs **no** `CompanyPartnership` lookup. A partnership-aware check does exist in the codebase — `MembershipEligibilityService.hasCapability` joins `company_partnerships` on `type` and `status = 'ACTIVE'` — but it is only registered and exported in `identity.module.ts` and has **no call site in any request path**.
- **Current technical enforcement:** **PARTIALLY ENFORCED.** The two components must be read separately:
  - *Tenant / company context* — **ENFORCED.** `TenantGuard` resolves an ACTIVE membership in an ACTIVE company, `app.tenant_id` is set transaction-locally, and the `procurement_needs` tenant policy applies.
  - *Partner relationship prerequisite* — **NOT ENFORCED.** Nothing requires an ACTIVE `CompanyPartnership` before a need may be created. A company with an ACTIVE membership but no active partnership is not rejected by the current intake path.
- **Future enforcement requirement:** the partnership prerequisite stated above should become enforceable (R7-01, R7-03). **This batch does not implement it.**

#### CPF-06 — Procurement Need Intake → Procurement Operations

- **Business reason:** core procurement partnership; qualified demand must become allocatable work.
- **Minimum data:** `procurement_need_id`, owning `company_id`, optional `project_id`, `product_identity_id`, `unit_id`, quantity, need date, maturity.
- **Prohibited data:** partner internal commercial intent, raw document content beyond extracted structured lines.
- **Authorization basis:** SCO operator capability `execution.manage`; eligibility conditions enforced in gateway.
- **Audit requirement:** allocation events recorded with actor, quantity and idempotency key.
- **Evidence:** `internal_execution_assign` requires maturity `READY`, ACTIVE product, ACTIVE project when present, and rejects `READY_QUANTITY_EXCEEDED`; writes `ready_allocation_events`.
- **Future enforcement:** flow should be purpose-labelled so that need data entering operations is distinguishable from need data entering any future intelligence purpose.

#### CPF-09 — Buy-Side Sourcing → Commercial Pricing

- **Business reason:** SCO prices from its own realised cost basis (Strategic Baseline Addendum D).
- **Minimum data:** approved purchase cost snapshot identifier, approved quantity, currency, unit cost.
- **Prohibited data:** supplier identity and negotiation history are not required by pricing to compute a selling position; they must not be copied into pricing artefacts that later feed partner-facing output.
- **Authorization basis:** SCO operator capability on both sides.
- **Audit requirement:** source selection and its audit evidence persisted atomically.
- **Evidence:** `pricing_cost_allocations` reference `approved_purchase_cost_snapshot_id`; `internal_offer_issue` validates snapshot status, approved quantity and supplier quote validity.
- **Future enforcement:** minimization check that pricing artefacts carry cost basis without supplier-identifying fields.

#### CPF-11 — Commercial Offer → partner egress

- **Business reason:** the partner must receive SCO's own sale offer to accept or reject it.
- **Minimum data:** exactly the fields listed in PUR-11.
- **Prohibited data:** pricing derivation, purchase cost, supplier identity, purchase source, margin, overhead, contribution, internal approval reasoning.
- **Authorization basis:** partner tenant context (`app.tenant_id = p_company`) plus `offer.partner_read`.
- **Audit requirement:** acceptance audited under TENANT scope.
- **Evidence:** `partner_offer_projection` field list; negative assertion in `partner-offer-revisions.integration.test.ts:161`.
- **Future enforcement:** the negative assertion should become a reusable purpose-egress check rather than a per-test regex.

#### CPF-22 — Verify → partner Verify result

- **Business reason:** deliver the verification outcome the partner requested.
- **Minimum data:** request/revision/run/result identifiers, status, classification, finalized timestamp, per-currency coverage counts and percentages.
- **Prohibited data:** supplier identity, supplier cost, purchase source, negotiation history, evidence identifiers, confidence context, variance data, exclusions/limitations, raw content, internal workflow metadata.
- **Authorization basis:** ACTIVE membership in ACTIVE `type='PARTNER'` company with `partner_verify.read`, plus `app.actor_id`/`app.tenant_id` cross-check inside the gateway.
- **Audit requirement:** read access should be attributable. **Gap:** the read gateway performs no audit insert — it is deliberately SELECT-only, so partner result reads are not individually audited.
- **Evidence:** `0086`; DTO key assertion in `partner-verify-result.integration.test.ts`.
- **Future enforcement:** decide whether partner Verify reads require audit, consistent with PUR-16.

#### CPF-23 … CPF-27 — Verify → procurement, pricing, offer, intelligence, supplier workflow

- **Business reason:** none approved. Verify is a confidential service bounded independently of the commercial spine.
- **Policy status:** DENIED BY DEFAULT for all five.
- **Prohibited data:** all Verify data, including derived or aggregated forms.
- **Authorization basis:** none exists. The denial itself is already established by the Owner-approved Default Deny rule and needs no decision; only a future exception would require one (FOG-4).
- **Evidence of current state:** no reference to `verify_*` tables or Verify models exists anywhere outside migrations `0082`–`0086` and `apps/api/src/modules/verify`; all 13 current Verify-related tables (10 from `0082` plus 3 from `0084`) revoke access from `sco_runtime` and `sco_internal_executor`.
- **Current technical enforcement:** NOT ENFORCED (no code path exists). The separation is real today but rests on absence plus table-level revocation, not on a mechanism that would reject a newly written connection.
- **Future enforcement:** a purpose-aware check that would deny a future Verify→commercial read even if a developer granted the privilege.

#### CPF-29 / CPF-30 — buy-side cost and supplier identity → partner egress

- **Business reason for denial:** Strategic Baseline Addendum B and D. SCO buys in its own name and presents its own offer; it is not transmitting supplier terms. The internal supply network is not a partner-facing directory.
- **Prohibited data:** supplier company identity, purchase source, supplier quote content, negotiated and approved purchase cost, negotiation history, alternative-product supplier reasoning.
- **Authorization basis:** none; denial is categorical.
- **Evidence:** `0085` Section 7 revocations; `buy-side-trust-boundary.integration.test.ts` denying all fifteen tables under every spoof combination and returning `null` to partner/supplier/dual actors from internal gateways; `partner-offer-revisions.integration.test.ts` negative assertion.
- **Current technical enforcement:** ENFORCED — the strongest boundary in the repository.

#### CPF-31 — partner/project identity → supplier-facing context

- **Business reason for denial:** a partner's identity, project identity and site context are partner-confidential; suppliers have no entitlement to them.
- **Current technical enforcement:** NOT ENFORCED, for the structural reason that **no supplier access context exists at all** (006-A section E.11). The flow is impossible today, not prevented.
- **Future enforcement:** if suppliers ever become an access context (FOG-5), this denial becomes immediately load-bearing and must be implemented before that context is created.

#### CPF-32 — Audit evidence → commercial purposes

- **Business reason for denial:** audit and security records exist for accountability, security, traceability and evidence. Converting them into a commercial dataset would repurpose records collected for a protective reason.
- **Prohibited data:** all audit records, including derived behavioural summaries.
- **Authorization basis:** none; only an approved use case could establish one.
- **Current technical enforcement:** NOT ENFORCED (no code path exists). Note the related gap: `audit_logs` is append-only by grant and convention, not by trigger.

#### CPF-33 — operational procurement history → buying-power aggregation

- **Business reason:** aggregate demand and commitment visibility to improve SCO's buying position.
- **Minimum data (currently implemented):** quantities per `product_identity_id` + `unit_id` per horizon and time bucket.
- **Prohibited data at the output layer:** partner identity, project identity — structurally absent from `buying_power_snapshot_lines`.
- **Qualification:** `buying_power_snapshot_source_memberships` retains identifiable lineage. This flow is ALLOWED for the **aggregate output**; the lineage remains inside PUR-17's internal boundary and its exposure beyond that boundary falls under FOG-1.
- **Authorization basis:** SCO operator capability.
- **Audit requirement:** aggregation runs recorded with publisher, cutoff and source fingerprint.
- **Evidence:** `0061_buying_power_foundation`; `0069`–`0071`.

#### CPF-34 / CPF-35 / CPF-36 — broader Procurement Intelligence inputs

- **Business reason:** plausible product value in richer intelligence (supplier performance, price history, partner/project patterns).
- **Why not ALLOWED:** the Strategic Baseline does not establish an authorization basis for reusing operational records — collected to execute a specific partner's procurement — as inputs to a separate analytical purpose, and minimization cannot be defined without a product decision about identifiability.
- **Why not DENIED:** business value is credible and the Roadmap positions Procurement Intelligence as a future stage.
- **Resolution:** OWNER DECISION REQUIRED before any such flow is built (FOG-1). This does not block closing 006-B; it blocks building the capability.

#### CPF-37 / CPF-38 — Procurement Intelligence feedback into sourcing and pricing

- **Business reason:** intelligence is only valuable if it informs decisions.
- **Why OWNER DECISION REQUIRED:** feeding intelligence into sourcing or pricing would materially alter current commercial behaviour, which section 17 of the authorization explicitly designates an Owner matter. Additionally, if the intelligence were derived from identifiable partner data, this would complete a loop in which one partner's data influences another partner's commercial outcome — a decision engineering must not make.

## I. Verify Boundary

Verify (PUR-14) remains independently bounded. The following are restated as contract, each mapped to the critical separations required by the authorization.

**A. Verify ≠ Procurement.** Different purposes, different tables, different lifecycle, different authorization. Verify consumes a partner-submitted quote; procurement consumes partner demand. No implemented path connects them (CPF-23).

**B. Verify ≠ Procurement Intelligence.** Verify data is excluded from intelligence by default (CPF-26) and that exclusion is restated in PUR-17.

**C. Verify Result ≠ SCO Commercial Offer.** A Verify result is produced by a methodology run over a partner's own quote. A commercial offer is SCO's own priced sale instrument derived from SCO's buy-side cost. They have different authorship, different lifecycles, different immutability rules and different partner projections. No code path converts one into the other.

**Scope of what the partner actually receives.** The current partner-facing Verify result is a limited projection of eight top-level fields with per-currency coverage, nothing more. Coverage, confidence, partial-result semantics and evidence provenance exist in the internal record; only coverage is projected.

**Supplier/cost/source/evidence confidentiality.** None of these appear in the Verify partner projection, and the gateway does not select them at all, so there is no confidential value present for the service layer to leak.

**No automatic authorization.** The following remain unauthorized and may not be enabled by engineering judgement: Verify → Procurement Intelligence, Verify → Sales, Verify → Commercial Pricing, Verify → Commercial Offer, Verify → Supplier workflow. The default denial is already Owner approved and requires no further decision; a legitimate product use case seeking an **exception** to it is classified **OWNER DECISION REQUIRED** (FOG-4).

**Honest statement of enforcement.** Verify's isolation today is the product of (a) no connecting code path existing, (b) `REVOKE ALL … FROM PUBLIC, sco_runtime, sco_internal_executor` on all 13 current Verify-related tables (10 introduced by `0082`, 3 added by `0084`), (c) FORCE RLS with narrow policies, and (d) a dedicated SELECT-only read-owner role for the single partner projection. This is strong, but it is not a purpose-aware control: it would not by itself reject a future privileged component deliberately wired to read Verify for a commercial purpose.

## J. Procurement / Buy-Side / Sell-Side Boundary

The approved commercial model is reflected as three separate purposes with two one-way boundaries.

```
PARTNER                SCO INTERNAL                         SCO → PARTNER
PUR-05  ───CPF-06──▶  PUR-06 ──CPF-07──▶ PUR-07 ──CPF-09──▶ PUR-10 ──CPF-10──▶ PUR-11 ──CPF-11──▶ partner
need                  operations         buy-side           pricing            sell-side offer
                                         sourcing
                                            ▲
                                            │ CPF-08
                                         PUR-08 internal supply network
```

Contractual statements:

1. **Partner procurement need ≠ SCO buy-side sourcing decision.** The partner expresses a need; SCO independently decides how to source it. The need does not entitle the partner to the sourcing decision, and the sourcing decision does not become partner data by virtue of serving the need.
2. **SCO buy-side cost/source ≠ partner-facing sell-side offer, by default.** The transition from PUR-07 to PUR-11 passes through PUR-10 and emerges as a selling position. Cost, source and supplier identity stop at the PUR-10/PUR-11 boundary (CPF-29, CPF-30).
3. **SCO is not a negotiation agent.** This contract models no flow in which supplier terms are transmitted to the partner. The partner receives SCO's own offer, and accepts or rejects it.
4. **Optimal supply source.** No purpose rule here requires sourcing from any particular tier. Source selection remains an operational and economic judgement within PUR-07/PUR-08.
5. **Low friction is not an authorization.** Streamlining intake (PUR-05) does not create any new permitted flow, and must not be cited as a reason to widen a boundary.

## K. Internal Supply Network Boundary

1. The supply network is **internal commercial and knowledge infrastructure**, not a partner-facing directory (Strategic Baseline Addendum B).
2. Supplier presence in data is a **commercial counterparty reference**, not ownership and not visibility (006-A critical distinction F).
3. There is currently **no supplier access context** — no supplier authentication, no supplier membership provisioning, no supplier-facing endpoint.
4. Supplier identity, purchase source, supplier qualification and capability, and supplier quote content are DENIED BY DEFAULT for partner egress (CPF-30), and that denial is enforced today.
5. Conversely, partner and project identity are DENIED BY DEFAULT toward supplier-facing context (CPF-31). This denial is currently unenforced only because the supplier context does not exist; it must be implemented before any supplier context is created (FOG-5).
6. Internal access within the supply network is already capability-separated and assignment-scoped, not blanket.

## L. Documents Purpose Rules

1. **A document is an asset, not a purpose.** Documents have custody (PUR-15); their *use* is governed by the purpose consuming them.
2. **No automatic reuse.** A document available for one operational purpose is not thereby reusable for another. Each document flow is enumerated: CPF-18 (procurement intake), CPF-19 (buy-side), CPF-20 (Verify). CPF-21 (studies) is NOT IMPLEMENTED.
3. **Scope partition is already real.** `documents.access_scope ∈ {TENANT, SCO_INTERNAL}` and the tenant policy requires `access_scope='TENANT'`, so an internally-scoped document is not reachable through the tenant path even though the row carries the company's `company_id`.
4. **Same-company constraint for Verify.** Verify raw content and evidence documents must belong to the same company as the owning Verify request, enforced by trigger, not by convention.
5. **Verify raw content is the most restricted document class.** Default posture is zero human access; access requires partner consent *and* an internally authorized, purpose-specific, scope-specific, time-limited grant whose approver differs from the actor; every open is recorded as an immutable event. Raw content may not flow to any non-Verify purpose (CPF-28).
6. **Storage keys are never disclosed.** Metadata responses expose filename, MIME type and size only.
7. **Not implemented, recorded as contract gaps:** watermarking, export control, expiring access, retention, disposal. This contract defines no control here; it records their absence so no later stage assumes them.

## M. Audit / Security Evidence Rules

1. Audit and security records exist **primarily for accountability, security, traceability and evidence**.
2. They are **not an ordinary commercial data source**. Commercial reuse is **DENIED BY DEFAULT** (CPF-32) and may change only through an approved use case.
3. Writing audit evidence is **mandatory** for every purpose (CPF-41) and is never a cross-purpose concession.
4. Audit scope partitioning already separates tenant accountability from operator and system accountability; this partition must be preserved.
5. Secrets are filtered from audit metadata by key pattern before insert.
6. **Recorded gap:** `audit_logs` append-only behaviour rests on grants and convention rather than an UPDATE/DELETE-rejecting trigger, unlike Verify history which rejects mutation even for the database owner.
7. **Recorded gap:** partner Verify result reads are not individually audited (the read gateway is deliberately SELECT-only).

## N. Procurement Intelligence Future Boundary

This section defines the purpose boundary PI will need, without pretending Stage 010 exists.

**Eligible as future PI input, subject to Owner decision:**

- aggregate operational demand and commitment quantities (already implemented as buying power, CPF-33);
- procurement execution outcomes in aggregate;
- buy-side cost and supplier performance history — **FOG-1**;
- catalog-level product and category structure (neutral reference data).

**Excluded from PI by default:**

- all Verify data, in any form including derived or aggregated (CPF-26);
- audit and security evidence (CPF-32);
- raw document content of any class;
- partner-identifiable and project-identifiable data, unless an Owner decision establishes basis and minimization (CPF-36);
- partner commercial offer acceptance behaviour, which is partner-identifiable by nature.

**Minimum data / aggregation requirements for any future PI:**

1. The output layer must remain non-identifiable by construction, as `buying_power_snapshot_lines` already is — keyed by product and unit, carrying no company or project.
2. Identifiable lineage may exist for correctness and auditability but must remain inside the internal boundary; its exposure beyond that falls under **FOG-1**.
3. Aggregation thresholds (minimum contributor counts before a figure may be published) are **not defined** today and cannot be defined without a product decision.
4. Storage by SCO is not an authorization. Data does not become intelligence input merely because SCO holds it.

**Feedback loops:** PI output influencing sourcing (CPF-37) or pricing (CPF-38) is OWNER DECISION REQUIRED, because it would materially alter current commercial behaviour and could allow one partner's data to influence another partner's outcome.

## O. Current Enforcement vs Contractual Policy

The single most important observation of this batch: **the repository's boundaries are strong where they are implemented, and the contract's denials are mostly unenforced because the flows simply do not exist.**

| Boundary | Policy | Technical enforcement today |
| --- | --- | --- |
| Buy-side data unreachable from tenant runtime | DENIED | **ENFORCED** — all spoof combinations denied, SQLSTATE 42501 |
| Supplier identity/cost out of partner offer | DENIED | **ENFORCED** — allowlist projection + negative test |
| Verify partner projection minimization | ALLOWED minimized | **ENFORCED** — two-layer allowlist, fail-closed |
| Verify → commercial/intelligence | DENIED | **NOT ENFORCED** — absence of code path only |
| Audit → commercial | DENIED | **NOT ENFORCED** — absence of code path only |
| Partner/project identity → supplier context | DENIED | **NOT ENFORCED** — supplier context does not exist |
| Purpose-aware authorization | required by contract | **NOT IMPLEMENTED** — permissions are purpose-blind |
| Purpose-aware audit | required by contract | **NOT IMPLEMENTED** — audit records action, not purpose |
| Minimization enforcement | required by contract | **PARTIALLY ENFORCED** — per-projection allowlists, no general mechanism |
| Document reuse control | required by contract | **PARTIALLY ENFORCED** — `access_scope` + same-company triggers only |

Four gaps follow directly:

- **G-01 Purpose is not a first-class concept.** No table, column, token, guard or audit field records the purpose of an access. Every boundary is structural.
- **G-02 Denials rest on absence.** The strongest Verify and audit denials would not reject a deliberately written future path.
- **G-03 Minimization is per-surface.** Each projection re-implements its own allowlist; a new surface could omit one without any systemic check failing.
- **G-04 Audit records action, not purpose.** Post-hoc, one cannot answer "for what purpose was this read?" from `audit_logs`.

## P. Owner Decisions

### P.1 Owner decisions required now to close 006-B

**NONE.**

Every boundary asserted by this contract is justified either by the already Owner-approved Default Deny rule, by the Strategic Baseline and its Addendum, or by current repository evidence. No new Owner decision is needed to establish, justify or close any boundary in this document.

In particular, **Default Deny for Cross-Purpose Reuse is already Owner approved**. Each `DENIED BY DEFAULT` classification in section H is an application of that approved rule, not a new decision awaiting one.

### P.2 Future Owner gates

These are **not blockers to closing 006-B**. They are gates that must be passed *before* the corresponding future capability is built. Each consolidates the related items raised during drafting; former identifiers are retained for traceability only.

| Gate | Area | Scope of the future decision | Consolidates | Related |
| --- | --- | --- | --- | --- |
| **FOG-1** | Procurement Intelligence scope | What PI is; whether it may operate on identifiable data; whether buy-side cost and supplier performance history may be inputs; whether partner-identifiable and project-identifiable data may be inputs; whether identifiable buying-power lineage may be exposed beyond its current internal boundary | former OD-01, OD-02, OD-03, OD-10 | CPF-33 … CPF-36, PUR-17 |
| **FOG-2** | Procurement Intelligence feedback loops | Whether PI output may feed back into buy-side sourcing and into commercial pricing | former OD-04, OD-05 | CPF-37, CPF-38 |
| **FOG-3** | Studies purpose definition | Definition of the Engineering Studies / Advisory purpose (PUR-18) and its data relationship to projects and to procurement | former OD-06 | PUR-18, CPF-39, CPF-40 |
| **FOG-4** | Verify secondary-use exception | **The default is already settled:** Verify secondary use is DENIED BY DEFAULT under the Owner-approved Default Deny rule, and no decision is required to establish it. A decision is required **only** to grant a future *exception* permitting Verify information to be used for a secondary commercial purpose | former OD-07 | CPF-23 … CPF-28, PUR-14 |
| **FOG-5** | Supplier access context | Whether suppliers ever become an access context and, if so, the disclosure boundaries and minimum data applicable to them | former OD-08 | PUR-08, CPF-31 |
| **FOG-6** | Retention / disposal policy | Retention and disposal for documents, Verify history and audit evidence, consistent with the already approved *Sensitive Document Controls — Policy First, Controls Second* | former OD-09 | PUR-15, PUR-16 |

Engineering must not resolve any FOG by preference, and must not treat an unresolved FOG as permission to proceed with the capability behind it.

## Q. Engineering Feedback

Observations offered to the Owner as input, not as decisions or designs.

1. **The hardest boundaries are already built; the softest are the newest.** Buy-side isolation is enforced to an unusually high standard. The boundaries that are purely contractual today are precisely the ones involving purposes that do not fully exist yet (PI, Studies). This is the normal and safer failure mode, but it means the contract is currently doing the work that code will eventually need to do.

2. **Purpose-blind permissions are the central structural gap.** A permission currently answers "may this actor perform this action?" and never "for what purpose?". Every denial in section H that is marked NOT ENFORCED traces back to this single gap.

3. **Denial-by-absence is fragile over time.** Verify's separation is excellent today precisely because nothing connects to it. That property degrades silently as the codebase grows; nothing would fail if a future component were wired in deliberately.

4. **Minimization is duplicated, not centralised.** Six partner-facing projections each hand-maintain an allowlist, and two of them are protected by test assertions. A seventh surface could be added without any shared mechanism objecting.

5. **The buying-power design is an accidental best practice worth preserving.** Aggregating to `product_identity_id` + `unit_id` with no company or project column means the output layer is non-identifiable by construction rather than by policy. Whatever PI becomes, this property is worth keeping deliberately.

6. **Two small current gaps are worth noting without expanding scope:** the procurement document extract route lacks a permission decorator, and `audit_logs` lacks the mutation-rejecting trigger that Verify history has. Both are recorded facts, not remediation requests — no remediation is authorized in this batch.

7. **The partner Verify read is unaudited by design of the SELECT-only gateway.** Whether that is acceptable is a policy question that interacts with PUR-16.

## R. Future Stage 007 Enforcement Requirements

Requirements only. This section designs nothing, chooses no schema, no migration structure, no guard change, and writes no code.

| ID | Requirement | Derived from |
| --- | --- | --- |
| **R7-01** | Purpose-aware authorization: an authorization decision must be able to consider the purpose of an access, not only the actor, tenant and permission | G-01, B.1 |
| **R7-02** | Purpose-aware audit: audit evidence must be able to record the purpose under which data was accessed | G-04, PUR-16 |
| **R7-03** | Flow enforcement: cross-purpose flows must be enforceable such that a flow marked DENIED BY DEFAULT fails even if technical privilege is present | G-02, CPF-23 … CPF-32 |
| **R7-04** | Minimization enforcement: a shared mechanism for purpose egress allowlists, so a new partner-facing surface cannot silently omit one | G-03, CPF-11, CPF-22 |
| **R7-05** | Derivation constraint propagation: derived and aggregated artefacts must retain their source purpose constraints | G.1 rule 2 |
| **R7-06** | Identifiability classification: data elements must be classifiable as identifiable or non-identifiable so minimization rules can be evaluated | PUR-17, FOG-1 |
| **R7-07** | Flow registry: the CPF catalogue must be representable as engineering configuration, so policy and enforcement cannot drift apart | H |
| **R7-08** | Owner-decision gating: flows marked OWNER DECISION REQUIRED must be incapable of operating until an approved decision is recorded | P |

Explicitly **out of scope for Stage 007 as defined here:** creating Service Access, Entitlement, Agent/Principal models, identity masking, document controls, Procurement Intelligence, or Digital Workspaces. Those remain separate, separately authorized work.

## S. Evidence Index

### Primary contract input

| Path | Role |
| --- | --- |
| `docs/architecture/stage-006-domain-data-ownership-matrix.md` | 006-A ownership baseline; ownership axis for every purpose here |

### Migrations

| Migration | Purpose evidence |
| --- | --- |
| `0001_foundation`, `0002_security_gate_identity`, `0003_runtime_role_least_privilege` | PUR-01, PUR-02 |
| `0004_rbac_audit_documents` | PUR-02, PUR-15, PUR-16 |
| `0006_global_product_catalog` | PUR-09 |
| `0008_procurement_document_extraction` | PUR-05, PUR-15 |
| `0009_rolling_planning` | PUR-04, PUR-05 |
| `0010_weekly_procurement_execution` | PUR-06 |
| `0011_supplier_network` | PUR-08 |
| `0013_rfq_quotes_purchase_cost` | PUR-07 (note: `rfqs` has no `company_id`) |
| `0020_supplier_quote_document_access_isolation` | PUR-15, CPF-19 |
| `0024_source_selection_authorization_audit` | PUR-07, CPF-09 |
| `0026_commercial_pricing_foundation` | PUR-10 |
| `0028_partner_offer_revisions` | PUR-11, CPF-10, CPF-11 |
| `0029_partner_po_commercial_commitment`, `0030_payments_funding_foundation`, `0031_cash_funding_evaluation_status_fix` | PUR-12 |
| `0033_procurement_release` | PUR-12, PUR-13 |
| `0038_supplier_purchase_order_core`, `0046_supplier_commercial_document_foundation`, `0056` | PUR-13, PUR-15 |
| `0060_partner_supplier_delivery_projections`, `0072`, `0073`, `0076` | PUR-13, CPF-15 |
| `0061_buying_power_foundation`, `0065`–`0071` | PUR-17, CPF-33 |
| `0077`–`0081` | PUR-08 |
| `0082_verify_foundation`, `0083`, `0084` | PUR-14 |
| `0085_internal_gateway_security_remediation` | PUR-03, PUR-06, PUR-07, PUR-08, PUR-09 |
| `0086_partner_verify_result_read` | PUR-14, CPF-22 |

### Application code

| Path | Purpose evidence |
| --- | --- |
| `apps/api/src/modules/auth/guards/auth.guard.ts`, `session.service.ts` | PUR-01 |
| `apps/api/src/common/tenant/tenant.guard.ts`, `partner-company.guard.ts` | PUR-02, PUR-14 |
| `apps/api/src/modules/identity/memberships.service.ts`, `sco-internal.guard.ts` | PUR-02, operator context |
| `apps/api/src/modules/rbac/permission.guard.ts`, `permissions.service.ts` | PUR-02 |
| `apps/api/src/database/tenant-transaction.service.ts`, `internal-database.service.ts` | context mechanism, PUR-06 … PUR-13 |
| `apps/api/src/modules/identity/execution.service.ts` | PUR-06 partner status projection |
| `apps/api/src/modules/documents/storage-provider.ts`, `supplier-quote-document.service.ts`, `procurement-documents.service.ts` | PUR-15 |
| `apps/api/src/modules/audit/audit.service.ts` | PUR-16 |
| `apps/api/src/modules/verify/partner-verify.controller.ts`, `partner-verify.service.ts` | PUR-14, CPF-22 |

### Tests establishing actual boundaries

| Path | Boundary proven |
| --- | --- |
| `apps/api/test/database/buy-side-trust-boundary.integration.test.ts` | PUR-07/PUR-08 isolation under all spoof combinations; capability separation; external actors receive null |
| `apps/api/test/database/partner-offer-revisions.integration.test.ts` | CPF-11 / CPF-29 — projection excludes pricing, purchase, supplier, source, margin, overhead, contribution, approval reasoning |
| `apps/api/test/database/partner-verify-result.integration.test.ts` | CPF-22 — exact DTO key set, no confidential patterns, read-only gateway |
| `apps/api/test/integration/partner-verify-http.integration.test.ts` | PUR-14 HTTP authorization wiring |
| `apps/api/test/database/supplier-po-scoped-visibility.integration.test.ts` | PUR-08/PUR-13 scoped visibility, no direct table reads |
| `apps/api/test/database/batch-8-commercial-confidentiality.integration.test.ts` | PUR-10/PUR-11 separation |
| `apps/api/test/database/postgres-rls.integration.test.ts`, `rls-context.integration.test.ts` | PUR-02 tenant boundary |
| `apps/api/test/database/sr01-sr02-internal-gateway-security.integration.test.ts` | operator gateway boundary after `0085` |
| `apps/api/test/database/verify-foundation-security.integration.test.ts`, `verify-request-quote-lifecycle.integration.test.ts` | CPF-20 same-company documents; Verify immutability |
| `apps/api/test/database/buying-power-foundation.integration.test.ts`, `buying-power-views.integration.test.ts` | CPF-33 aggregation |
| `apps/api/test/database/batch-8-audit-coverage.integration.test.ts` | PUR-16 coverage |

### Negative evidence (searched, not found)

| Search | Result |
| --- | --- |
| `study` / `studies` / engineering-study terms across `src`, `migrations`, `test`, `docs` | **No match** — PUR-18 is unimplemented |
| References to `verify_*` tables outside `0082`–`0086` and `modules/verify` | **No match** — CPF-23 … CPF-27 have no code path |
| Supplier-facing HTTP route or supplier authentication path | **No match** — no supplier access context (CPF-31) |
| `workspace`, `service access`, `subscription`, `watermark`, `expiring`, `disposal`, `pseudonym`, `unmask` | **No match** — recorded as not implemented |

### Documentation drift recorded (not reconciled)

| Path | Drift |
| --- | --- |
| `docs/architecture/stage-005-verify-v0.1.md` | Self-described as Batch 1-A and "not implementation authorization", yet its contract is now largely implemented by `0082`–`0086`. Its stated invariant that "no Verify event automatically feeds Procurement Intelligence or procurement execution" is consistent with CPF-23/CPF-26 and is adopted here as policy, with the honest note that it is enforced by absence rather than by mechanism. Its "RETENTION POLICY PENDING" register entry is carried forward as FOG-6 |
| `docs/architecture/tenant-isolation.md` | Accurate for the `0001`–`0004` scope; does not cover the gateway-role architecture of `0084`–`0086`, so it understates current enforcement |
| `README.md` | Consistent: Production deployment disabled, Supplier Portal out of scope — supports PUR-08 and CPF-31 |
