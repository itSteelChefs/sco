# Stage 006 — Batch 006-E — Principal Compatibility, Entitlement & Service Access Contract

## A. Contract Status & Authority

This document is the authoritative Stage 006 contract for three related but strictly distinct concerns:

1. **Principal Compatibility** — what kinds of actor the authorization and audit model must be able to represent.
2. **Entitlement** — whether a company has a service available to it at all.
3. **Service Access** — how an SCO workforce principal may act inside a Partner context *without* organizational membership.

Batch 006-E is **documentation / contract only**. It implements nothing: no runtime code, no schema, no migration, no database change, no API, no Service Access implementation, no Entitlement implementation, no Workspace implementation, and no Agent implementation.

| Authority | Status |
| --- | --- |
| Engineering baseline `c2f2ad4a37ef06995c75f08c5fdc52de24909271` | Authoritative HEAD for all evidence |
| 006-A Domain & Data Ownership Matrix | CLOSED — not reopened |
| 006-B Purpose Taxonomy & Cross-Purpose Flow Contract | CLOSED — not reopened |
| 006-C Disclosure & Identity Matrix | CLOSED — not reopened |
| 006-D Sensitive Document Policy | Builder candidate, consistent with this contract |
| Owner decision: **Service Access must not be implemented now** | Governing |
| Owner decision: **No Agent Model now** | Governing |
| Strategic Baseline, Addendum, Digital Workspaces principles | Governing |

**Why this contract exists now.** Service Access is a mandatory architectural dependency before either of two future events: the first Partner Private Workspace, or an SCO employee entering a Partner context without organizational membership. If its semantics are not fixed in Stage 006, Stage 011 and Stage 012 would be free to invent access semantics — which is precisely the outcome the Stage sequence exists to prevent. This contract fixes the semantics without building anything.

**NO TRUST CLAIM WITHOUT EVIDENCE.** Every `ENFORCED` claim in section L cites a migration, source file or test. Absence is recorded as absence, never as a feature.

## B. Scope

In scope: the principal taxonomy the platform must be able to express; the membership model as it exists today; the entitlement concept and its current absence; the permission model as it exists today; the full semantic contract for future Service Access; the SCO workforce model; multi-company user rules; the constraints Digital Workspaces must obey; current enforcement; gaps; and Stage 011 requirements as documentation only.

Out of scope: implementing any of the above; billing or subscription mechanics; agent activation; workspace runtime; resolution of FOG-1 … FOG-6; any change to 006-A/006-B/006-C.

## C. The Separation Chain

The single most important content of this contract. Six concepts form a chain, and **no link in the chain implies the next**. Each arrow below is explicitly *not* an implication.

```
IDENTITY  ⇸  MEMBERSHIP  ⇸  ENTITLEMENT  ⇸  PERMISSION  ⇸  PURPOSE AUTHORIZATION  ⇸  DISCLOSURE AUTHORITY
```

| Separation | Meaning | Why it matters |
| --- | --- | --- |
| **Identity ≠ Membership** | Being a known principal is not belonging to an organization | `"User"` is a global platform primitive (006-A); it carries no company |
| **Membership ≠ Entitlement** | Belonging to a company does not mean the company has the service | A member of a company with no Verify entitlement must not reach Verify |
| **Entitlement ≠ Permission** | A company having a service available does not mean a given member may use it | Availability is commercial; permission is organizational |
| **Permission ≠ Purpose Authorization** | Being allowed to perform an action is not being allowed to reuse its data for another purpose | 006-B Default Deny for cross-purpose reuse |
| **Purpose Authorization ≠ Disclosure Authority** | Being allowed to use data for a purpose is not being allowed to disclose it, or to disclose the identity inside it | 006-C disclosure levels |
| **CompanyPartnership ≠ Access** | A commercial relationship class is not an access grant | Partnership is an SCO-operated lifecycle record (006-A) |
| **Technical Access ≠ Service Access** | Being technically able to reach data is not being authorized to act inside a context | The core Service Access rule, section H |
| **Service Access ≠ CompanyMembership** | Serving a Partner is not becoming part of it | Section H.2 |

**Two directional rules that are easy to get backwards.**

- **Subscription determines company service availability.** It answers: *is this service available to this company at all?*
- **Permission determines who inside the company may use an available service.** It answers: *which member may act?*
- **Neither supplies purpose authorization, and neither supplies disclosure authority.** Those remain governed by 006-B and 006-C respectively, in every case, without exception.

A practical consequence that must survive into later Stages: an entitled company, with a permitted member, acting for an authorized purpose, still discloses only at the level 006-C permits.

## D. Principal Model (Principal Compatibility)

**POLICY REQUIREMENT.** Authorization and audit contracts must not require a principal to be human. This is a *compatibility* requirement, not an authorization to build an Agent Model.

### D.1 Principal classes present in the repository today

| ID | Principal class | Status | Evidence |
| --- | --- | --- | --- |
| **PRIN-1** | Human user principal | IMPLEMENTED | `"User"` + `"Session"`; `AuthService.login` verifies password and ACTIVE status; `AuthGuard` resolves a session per request |
| **PRIN-2** | Fixed system principal | IMPLEMENTED, narrowly | `public.verify_system_actor_id()` returns the fixed UUID `00000000-0000-4000-9000-000000005357`, inserted as a `"User"` row with email `verify-system@sco.internal` and `passwordHash` literal `SYSTEM_ACCOUNT_NO_LOGIN_NOT_A_REAL_HASH` |
| **PRIN-3** | Database role principal | IMPLEMENTED | `sco_runtime`, `sco_internal_executor`, `sco_internal_gateway_owner`, `sco_verify_system_executor`, `sco_verify_gateway_owner`, `sco_verify_partner_read_owner` |
| **PRIN-4** | General non-human / agent principal | **NOT IMPLEMENTED** | No agent, bot, service-account or machine-identity model exists |

### D.2 What PRIN-2 actually proves — and what it does not

PRIN-2 is genuine evidence that the platform already attributes actions to a non-human actor. Three precise observations:

1. **The non-human principal is modelled as a `"User"` row.** There is no separate principal type. The system actor borrows the human identity table.
2. **It cannot authenticate.** The password hash is a literal non-hash string, so `PasswordService.verify` cannot succeed against it; there is no login path for this principal.
3. **It cannot be impersonated by a caller.** The Verify SYSTEM gateways accept **no caller-supplied actor parameter at all**, so no caller holding `sco_verify_system_executor` can attribute an action to an arbitrary user; every SYSTEM-originated row and audit entry is attributed to the fixed identity.

**This is evidence, not permission to generalize.** PRIN-2 is a single fixed identity serving one subsystem. It is not a service-account model, not a credential model, and not a lifecycle model. Generalizing it would be building PRIN-4, which is not authorized.

### D.3 Principal compatibility requirements

| ID | Requirement |
| --- | --- |
| **PC-01** | Authorization decisions must be expressible for any principal class, not only PRIN-1 |
| **PC-02** | Audit attribution must identify the principal and its class, so a human action and a system action are distinguishable after the fact |
| **PC-03** | A principal must be separable from an organizational membership — a principal may act without being a member (section H) |
| **PC-04** | Authentication is a property of a principal class, not an assumption: PRIN-2 and PRIN-3 authenticate differently from PRIN-1, or not at all |
| **PC-05** | Policy wording across Stage 006 contracts must remain actor-neutral |
| **PC-06** | A non-human principal must be subject to the same purpose boundary (006-B) and disclosure rules (006-C) as a human one — automation is never a relaxation |

**Current state against PC-02.** `audit_logs.actor_user_id` records *which* actor, never *what kind* of actor. A SYSTEM action and a human action are indistinguishable in audit except by recognizing the fixed UUID. Registered as **EGAP-06**.

## E. Membership Model

**CURRENT REPOSITORY TRUTH**, stated without interpretation.

| Fact | Evidence |
| --- | --- |
| A membership binds exactly one user to exactly one company | `"CompanyMembership"` with `userId`, `companyId` |
| A user may hold independent memberships in multiple companies | `UNIQUE ("userId", "companyId")` constrains the pair, not the user |
| Membership has lifecycle status | `MembershipStatus ∈ {ACTIVE, SUSPENDED, REVOKED}` |
| Membership is the anchor of RBAC | `"MembershipRole".membership_id`, itself company-scoped |
| Membership is resolved server-side only | `MembershipsService.requireActiveMembership` |
| Explicit company selection is by header, validated against real memberships | `x-sco-company-id` validated in `TenantGuard`, UUID-pattern checked, then resolved |
| Ambiguity is rejected, never guessed | More than one ACTIVE membership without an explicit selection throws `TENANT_CONTEXT_REQUIRED` |
| Membership rows are protected at the database level | `FORCE ROW LEVEL SECURITY`; tenant policy on `app.tenant_id`; narrow actor-bootstrap read policy returning only the caller's own rows |

**POLICY REQUIREMENT — membership semantics.**

1. Membership expresses **organizational belonging**, nothing more. It is not entitlement, not purpose authorization, and not disclosure authority.
2. **No fallback context.** When the correct company context is ambiguous the request must fail, not default. A default context is an authorization leak.
3. Membership in company A grants nothing in company B, in any form, at any layer.
4. **Work and data remain company-owned when a person leaves.** Revoking a membership removes the person's access; it transfers no ownership and deletes no company asset.

**Current enforcement of rule 4.** `company_id` is the authoritative ownership key on business records (006-A) and is independent of `created_by`/`uploader_user_id`/`submitted_by`, which are attribution. Revoking a membership therefore cannot orphan or remove company assets — ownership never pointed at the person. — `ENFORCED` structurally.

**Honest gap.** Membership lifecycle transitions themselves are not audited: no membership-history table exists and no `membership.*` audit action is emitted. Registered as **EGAP-04**.

## F. Entitlement Model

**Definition.** Entitlement is **company-level service availability**: whether a given SCO service is available to a given company at all, independent of who inside that company may use it.

**CURRENT REPOSITORY TRUTH: NOT IMPLEMENTED.**

| Search at this baseline | Result |
| --- | --- |
| `subscription` | **0 files** |
| `service access` | **0 files** |
| `billing` | **0 files** |
| `licence` / `license` | **0 files** |
| `seat` | **0 files** |
| `entitlement` | **present — but exclusively `warranty_entitlement`** |

The last row is a naming collision that must not be mistaken for an entitlement model. Every occurrence of "entitlement" in the repository belongs to the **warranty** domain: `warranty_entitlements`, `warranty_entitlement_evidence`, `internal_warranty_entitlement_register`, `partner_warranty_entitlement_list`, `WARRANTY_ENTITLEMENT_IMMUTABLE`, and related identifiers. A warranty entitlement is a commercial obligation attached to delivered goods. It has **no relationship whatsoever** to service entitlement.

**POLICY REQUIREMENT — entitlement semantics.**

| ID | Requirement |
| --- | --- |
| **ENT-01** | Entitlement is evaluated at **company** scope, never at user scope |
| **ENT-02** | Entitlement answers availability only; it never answers "who may act" |
| **ENT-03** | Absence of entitlement must deny the service for every member, regardless of permission held |
| **ENT-04** | Entitlement must be revocable, and revocation must take effect without requiring permission changes |
| **ENT-05** | Entitlement is **not** purpose authorization — 006-B Default Deny continues to apply inside an entitled service |
| **ENT-06** | Entitlement is **not** disclosure authority — 006-C levels continue to apply inside an entitled service |
| **ENT-07** | Entitlement state changes must be auditable |
| **ENT-08** | Entitlement must be expressible independently of commercial billing mechanics, which remain out of scope |

**What today's absence means in practice.** Service availability is currently expressed *only* through permission grants: a company whose members hold no `partner_verify.read` permission effectively cannot reach Verify. This is availability-by-permission, which conflates ENT-02 and the permission model. It works, but it means a commercial decision ("this company has not subscribed to Verify") and an organizational decision ("this employee may not read Verify results") are represented by the same mechanism and cannot be distinguished. Registered as **EGAP-02**.

**Deliberate non-invention.** No entitlement table, column, enum or schema is proposed here. The requirement set above is sufficient for Stage 011 to design one correctly.

## G. Permission Model

**CURRENT REPOSITORY TRUTH.**

| Fact | Evidence |
| --- | --- |
| Permission codes are a global vocabulary | `"Permission".code` is `UNIQUE`, with no `company_id` |
| Role assignment is company-scoped | `"Role"`, `"MembershipRole"`, `"RolePermission"` each carry `company_id` with FORCE RLS and tenant policies |
| Evaluation is a join under tenant context | `PermissionsService.has` joins `MembershipRole → RolePermission → Permission` inside `withTenant` |
| Enforcement is declarative at the route | `PermissionGuard` + `@RequirePermission(...)`; absent metadata means no permission requirement |
| Internal capability checks are enforced in the database | `internal_has_capability(actor, code)` asserted as the first statement of each `internal_*` gateway |
| The vocabulary is large and domain-specific | Dozens of seeded codes spanning catalog, qualification, partnership, candidate, execution, supplier, RFQ, quote, negotiation, purchase cost, offer, pricing, delivery, payment, funding, buying power, warranty, Verify and partner-facing reads |

**POLICY REQUIREMENT.**

1. A permission authorizes an **action inside a purpose**. It never authorizes export of that data to another purpose (006-B), nor disclosure of identity (006-C).
2. Permission is evaluated **after** entitlement, once entitlement exists. Holding a permission in a non-entitled company must not grant the service.
3. Permission must remain company-scoped in assignment even though the code vocabulary is global.
4. A route without an explicit permission requirement is a policy decision, not an oversight, and must be deliberate.

**Honest gaps.** Permissions are **purpose-blind**: nothing in `PermissionsService` or `PermissionGuard` can express or evaluate *for what purpose* an action is performed — carried forward from 006-B and restated here because it is a property of the permission model itself. There is also no RBAC administration surface and no RBAC-change history. Registered as **EGAP-01** and **EGAP-05**.

## H. Service Access Contract

**Owner decision: Service Access must NOT be implemented now.** This section defines its semantics so that no later Stage may invent them. No schema, API or mechanism is designed.

### H.1 Definition

**Service Access** is a bounded authorization for an **SCO workforce principal** to act inside a **Partner context** for a defined **service scope**, **without** holding organizational membership in that Partner company.

It exists because the Digital Workspaces principle requires it: *the Partner does not enter SCO's office; SCO appears inside the Partner's company.* For SCO to appear inside a Partner's company, an SCO principal must be able to act in Partner context. The only mechanisms available today are membership (wrong — it would make SCO staff part of the Partner) or operator gateways (insufficient — they are SCO-context, not Partner-context). Service Access is the missing third mechanism.

### H.2 Required semantics

| ID | Element | Contract |
| --- | --- | --- |
| **SA-01** | **Relationship basis** | Service Access requires an existing, ACTIVE commercial relationship between SCO and the Partner company. It is grounded in the relationship, not in the individual |
| **SA-02** | **Partner context** | The access operates *inside* the Partner's tenant context. The acting principal sees Partner data as Partner-context data, subject to every rule that applies to that context |
| **SA-03** | **SCO workforce principal** | The principal is an SCO workforce principal, not a Partner member. Its home organizational context remains SCO throughout |
| **SA-04** | **Service scope** | Access is scoped to a named service and to the minimum data that service requires. It is never general access to the Partner company |
| **SA-05** | **Entitlement prerequisite** | The Partner company must be entitled to the service. No entitlement, no Service Access — regardless of relationship or permission |
| **SA-06** | **Permission** | The SCO principal must separately hold the permission required for the action. Service Access grants reach, never capability |
| **SA-07** | **Purpose** | Every Service Access action is bound to a declared purpose, and 006-B Default Deny applies unchanged. Service Access is never a cross-purpose bridge |
| **SA-08** | **Disclosure** | 006-C governs what the SCO principal may see and what may leave. Acting inside Partner context does not grant real-identity disclosure beyond the applicable level |
| **SA-09** | **Context isolation** | Service Access to Partner A grants nothing in Partner B. Access is per-Partner, per-service, and never aggregated into a cross-Partner view |
| **SA-10** | **Non-membership semantics** | Service Access must not create, imply, simulate or substitute for `CompanyMembership`. The principal is not a member, acquires no membership-derived rights, and appears as what it is |
| **SA-11** | **Revocation** | Revocable immediately and independently — by ending the relationship, withdrawing entitlement, removing permission, or revoking the access itself. Revocation must take effect without requiring the others |
| **SA-12** | **Auditability** | Every Service Access action is attributable to the SCO principal, the Partner context, the service scope and the purpose. Service Access actions must be distinguishable in audit from Partner-member actions |
| **SA-13** | **Lifecycle** | Bounded: it has a beginning, a scope, and an end. Standing, unbounded, open-ended Service Access is prohibited |
| **SA-14** | **No bypass** | Service Access must not become an authorization bypass. It composes with entitlement, permission, purpose and disclosure; it overrides none of them |

### H.3 The composition rule

Service Access is the **conjunction** of five independent conditions, never a substitute for any of them:

```
ACTIVE RELATIONSHIP
  ∧ COMPANY ENTITLED TO SERVICE
  ∧ SCO PRINCIPAL HOLDS PERMISSION
  ∧ DECLARED PURPOSE PERMITS THE ACTION
  ∧ DISCLOSURE LEVEL PERMITS WHAT IS SEEN
  ⇒ SERVICE ACCESS ACTION IS AUTHORIZED
```

If any conjunct fails, the action is denied. No conjunct may be inferred from another.

### H.4 Current state

**NOT IMPLEMENTED.** No Service Access mechanism, model, column, route or concept exists at this baseline. Today an SCO principal can reach Partner-related data only through SCO operator context — typed `internal_*` SECURITY DEFINER gateways with capability checks, running as `sco_internal_executor` with `app.tenant_id` set to the **SCO** company, not the Partner's. That is operator access, which is a different thing: it is SCO acting in SCO context on Partner-related records, not SCO acting inside Partner context.

The current absence is safe but structurally unguarded: nothing prevents a future implementation from taking the easy wrong path of granting SCO staff a `CompanyMembership` in the Partner company. **SA-10 exists specifically to prohibit that.** Registered as **EGAP-03**.

## I. SCO Workforce Model

**Principle: shared SCO workforce, isolated Partner context.**

**POLICY REQUIREMENT.** An SCO employee serving Company A must not automatically gain:

| Must not gain | Reason |
| --- | --- |
| Company A membership | Service Access is not membership (SA-10) |
| Company B context | Context isolation (SA-09) |
| Unrelated project access | Service scope is minimal (SA-04); project context is secondary to company context (006-A) |
| Unrelated service access | Entitlement and scope are per-service (SA-05, SA-04) |

**Current enforcement.** The SCO workforce is already a distinct, isolated access context. `ScoInternalGuard` resolves the caller's ACTIVE membership in an ACTIVE `type='SCO'` company under `app.actor_id`, sets `app.tenant_id` to **that SCO company**, then requires `sco.internal.manage`. The bootstrap read policy on `CompanyMembership` admits only the caller's own rows, and `MembershipRole`/`RolePermission` require `app.tenant_id` set to the SCO company, so a non-SCO or inactive actor reads nothing. — `ENFORCED` for the separation of SCO workforce from Partner membership.

**What is not enforced.** Nothing today expresses "SCO employee acting inside Partner context", because that capability does not exist. The enforcement above protects the boundary by making the crossing impossible rather than by governing it.

## J. Multi-Company Users

**Approved model, and current truth coincide.**

| Rule | Status | Evidence |
| --- | --- | --- |
| One user may hold independent memberships in multiple companies | `ENFORCED` | `UNIQUE ("userId", "companyId")` permits many rows per user |
| Explicit tenant/company context is required when ambiguous | `ENFORCED` | More than one ACTIVE membership without `x-sco-company-id` throws `TENANT_CONTEXT_REQUIRED` |
| No fallback context that can leak authorization | `ENFORCED` | The single-membership path resolves only when exactly one ACTIVE membership exists; a requested company is validated against the user's own memberships and a foreign, suspended or revoked selection is denied |
| Company selection is never trusted from the client | `ENFORCED` | The header is UUID-pattern validated then resolved server-side against real membership rows; it is an index into the user's memberships, never an assertion |
| Work and data remain company-owned after an employee leaves | `ENFORCED` structurally | Ownership is `company_id`; `created_by` and similar columns are attribution only (006-A) |
| Each membership's permissions are independent | `ENFORCED` | `MembershipRole` is keyed by `membership_id` and company-scoped |

**One honest nuance.** The dual-membership case is adversarially tested in the buy-side boundary suite: an actor holding memberships in both a PARTNER and a SUPPLIER company receives `null` from internal gateways, exactly as a single-membership external actor does. Multi-company membership therefore does not accumulate privilege.

## K. Digital Workspaces Dependency

Digital Workspaces are an approved future capability (Stage 012). This section states the constraints a Workspace must obey, so Stage 012 cannot invent access semantics. **No Workspace runtime, model or schema is designed here.**

| ID | Constraint on any future Workspace |
| --- | --- |
| **WS-01** | A Partner Private Workspace is isolated **in Partner context**. Its content is partner-owned under 006-A and tenant-bound |
| **WS-02** | Workspace membership or presence is **not** content authorization, **not** permission, and **not** purpose authorization |
| **WS-03** | An SCO principal appearing inside a Partner Workspace does so by **Service Access**, never by `CompanyMembership` (SA-10) |
| **WS-04** | A Workspace must not aggregate across Partners. One Workspace, one Partner context (SA-09) |
| **WS-05** | Content inside a Workspace remains governed by 006-B purpose boundary, 006-C disclosure levels and 006-D sensitive-document policy, unchanged |
| **WS-06** | Workspace actions are auditable and distinguishable from ordinary tenant actions (SA-12) |
| **WS-07** | A Workspace is not an entitlement. Workspace availability to a company is itself subject to the entitlement model (ENT-01 … ENT-03) |
| **WS-08** | Workspace participation must be expressible for any principal class, including future non-human principals (PC-01) |

**The governing sentence, restated because it is load-bearing:** *the Partner does not enter SCO's office; SCO appears inside the Partner's company.* Every constraint above follows from taking that sentence literally — the direction of travel is SCO into Partner context, which is why Service Access and not membership is the enabling mechanism.

## L. Current Enforcement Matrix

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A principal is authenticated before any authorization | `ENFORCED` | `AuthGuard` resolves a session or throws; `AuthService.login` verifies password and ACTIVE status |
| 2 | Session is opaque and server-verified | `ENFORCED` | SHA-256 token hash stored; raw token never persisted |
| 3 | Session has absolute and idle lifetimes and is revocable | `ENFORCED` | 8-hour absolute, 30-minute idle, `revokedAt`, status rechecked each request |
| 4 | Disabled users cannot act | `ENFORCED` | `SessionService.resolve` returns null unless user status is `ACTIVE` |
| 5 | Membership is resolved server-side, never asserted by the client | `ENFORCED` | `MembershipsService.requireActiveMembership`; header validated then resolved |
| 6 | Ambiguous company context is rejected, not defaulted | `ENFORCED` | `TENANT_CONTEXT_REQUIRED` when more than one ACTIVE membership and no explicit selection |
| 7 | Suspended, revoked or foreign company selection is denied | `ENFORCED` | Membership must be ACTIVE and in an ACTIVE company; otherwise `forbidden()` |
| 8 | Multi-company membership is supported without privilege accumulation | `ENFORCED` | `UNIQUE (userId, companyId)`; dual-membership actor receives `null` from internal gateways |
| 9 | Membership rows are protected at database level | `ENFORCED` | FORCE RLS; tenant policy; actor-bootstrap policy limited to the caller's own rows |
| 10 | Permission is evaluated under tenant context | `ENFORCED` | `PermissionsService.has` joins inside `withTenant` |
| 11 | Permission assignment is company-scoped | `ENFORCED` | `Role`, `MembershipRole`, `RolePermission` carry `company_id` with FORCE RLS tenant policies |
| 12 | Internal capability is enforced in the database, not only at the route | `ENFORCED` | `internal_has_capability` asserted first in each `internal_*` gateway |
| 13 | SCO workforce context is distinct from Partner context | `ENFORCED` | `ScoInternalGuard` requires SCO-company membership + `sco.internal.manage`; sets `app.tenant_id` to the SCO company |
| 14 | Company ownership survives personnel change | `ENFORCED` structurally | Ownership is `company_id`; person columns are attribution only |
| 15 | A non-human principal can be attributed without impersonation | `ENFORCED` | Verify SYSTEM gateways accept no caller-supplied actor; fixed identity used for all SYSTEM rows and audit |
| 16 | A non-human principal cannot authenticate | `ENFORCED` | System account password hash is a literal non-hash; no login path |
| 17 | Database-role principals are least-privilege and non-bypassing | `ENFORCED` | Runtime and gateway roles created `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`; owners are NOLOGIN |
| 18 | Entitlement exists as a distinct concept | `NOT IMPLEMENTED` | No subscription, entitlement, billing, licence or seat concept; "entitlement" in-repo means warranty only |
| 19 | Service availability is separable from individual permission | `NOT IMPLEMENTED` | Availability is currently expressed only through permission grants |
| 20 | Service Access exists | `NOT IMPLEMENTED` | No Service Access mechanism, model or concept at this baseline |
| 21 | An SCO principal can act inside Partner context without membership | `NOT IMPLEMENTED` | Only SCO-context operator gateways exist |
| 22 | Permission can express purpose | `NOT IMPLEMENTED` | Permission model is purpose-blind |
| 23 | Audit distinguishes principal class | `NOT ENFORCED` | `audit_logs.actor_user_id` records which actor, never what kind |
| 24 | Membership lifecycle transitions are audited | `NOT ENFORCED` | No membership history table; no `membership.*` audit action |
| 25 | Authentication events are audited | `NOT ENFORCED` | No login/logout audit action emitted |
| 26 | RBAC changes are audited | `NOT ENFORCED` | No RBAC-change history |
| 27 | RBAC administration surface exists | `NOT IMPLEMENTED` | No role-management endpoint found |
| 28 | A general non-human principal model exists | `NOT IMPLEMENTED` | PRIN-4 absent; PRIN-2 is one fixed identity, not a model |
| 29 | Workspace access semantics are defined | `CONTRACT ONLY` | Defined in section K; nothing implemented |
| 30 | Entitlement and Service Access semantics are defined | `CONTRACT ONLY` | Defined in sections F and H; nothing implemented |

Distribution: `ENFORCED` 17 · `NOT ENFORCED` 4 · `NOT IMPLEMENTED` 7 · `CONTRACT ONLY` 2 · total 30.

## M. Gap Register

| ID | Gap | Current evidence | Status | Boundary at risk | Future dependency |
| --- | --- | --- | --- | --- | --- |
| **EGAP-01** | Permissions are purpose-blind | `PermissionsService.has` evaluates actor + membership + code; no purpose dimension exists | `NOT IMPLEMENTED` | 006-B purpose boundary is contract-only at the authorization layer | Stage 007 |
| **EGAP-02** | No entitlement / service-availability model | 0 files for subscription, billing, licence, seat; "entitlement" is warranty-only | `NOT IMPLEMENTED` | Commercial availability and organizational permission are conflated | Stage 011 |
| **EGAP-03** | No Service Access mechanism | No model, column, route or concept | `NOT IMPLEMENTED` | Blocks Partner Private Workspace; risks a membership-based shortcut if built carelessly | Stage 011, blocking Stage 012 |
| **EGAP-04** | Membership lifecycle is unaudited | No membership history table; no `membership.*` action | `NOT ENFORCED` | Cannot evidence when access was granted or revoked | Stage 011 |
| **EGAP-05** | RBAC changes are unaudited and unadministered | No RBAC-change history; no management endpoint | `NOT ENFORCED` / `NOT IMPLEMENTED` | Cannot evidence how a permission was acquired | Stage 011 |
| **EGAP-06** | Audit does not record principal class | `actor_user_id` only | `NOT ENFORCED` | Human and system actions are indistinguishable except by recognizing a UUID | Stage 011 |
| **EGAP-07** | Authentication events are unaudited | No login/logout audit action | `NOT ENFORCED` | Session lifecycle is not evidenced | Stage 011 |
| **EGAP-08** | No general non-human principal model | PRIN-2 is a single fixed identity modelled as a `"User"` row | `NOT IMPLEMENTED` | Future automation would have no principal model to attach to | Stage 014, constrained by PC-01 … PC-06 |
| **EGAP-09** | Non-human principal shares the human identity table | System actor is a `"User"` row with a sentinel password hash | `PARTIALLY ENFORCED` | Works and is safe today, but conflates principal classes at the data layer | Stage 011 / Stage 014 |

**Gaps deliberately not claimed.** No gap is recorded for tenant isolation, cross-tenant leakage, privilege accumulation across memberships, or client-controlled context — all four are genuinely enforced and tested, and inventing a gap there would be exaggeration.

## N. Stage 011 Requirements

Stage 011 is **Identity, Entitlement & Service Access Foundations**. These are requirements, not designs; *what*, not *how*.

| ID | Requirement | Derived from |
| --- | --- | --- |
| **R11-01** | A company-scoped entitlement model must express service availability independently of individual permission | ENT-01 … ENT-08, EGAP-02 |
| **R11-02** | Absence or revocation of entitlement must deny the service for every member regardless of permission held | ENT-03, ENT-04 |
| **R11-03** | A Service Access model must allow an SCO workforce principal to act inside a Partner context without membership | SA-01 … SA-14, EGAP-03 |
| **R11-04** | Service Access must compose as a conjunction and must never substitute for entitlement, permission, purpose or disclosure | H.3, SA-14 |
| **R11-05** | Service Access must be per-Partner, per-service, scoped, bounded and immediately revocable | SA-04, SA-09, SA-11, SA-13 |
| **R11-06** | Service Access actions must be auditable and distinguishable from Partner-member actions | SA-12 |
| **R11-07** | A principal model must represent human, system and future non-human principals distinctly | PC-01, PC-04, EGAP-08, EGAP-09 |
| **R11-08** | Audit must record the principal class alongside the principal identity | PC-02, EGAP-06 |
| **R11-09** | Membership lifecycle transitions must be auditable | EGAP-04 |
| **R11-10** | Permission assignment changes must be auditable, and an administration surface must be governed | EGAP-05 |
| **R11-11** | Authentication and session lifecycle events must be auditable | EGAP-07 |
| **R11-12** | Multi-company context selection must remain explicit, with no fallback context, under any new mechanism | J, SA-09 |
| **R11-13** | Company ownership of work and data must remain independent of individual principals | E rule 4 |
| **R11-14** | The separation chain must remain non-implicative under any new mechanism | Section C |

**Stage boundary.** R11-01 … R11-14 are Stage 011 requirements. The purpose dimension of authorization (EGAP-01) belongs to **Stage 007**, not Stage 011, and is recorded here only because it is a property of the permission model. Nothing in this contract is assigned to an unauthorized Stage.

## O. Owner Gates & Owner Decisions

### O.1 Owner decisions required now

**NONE.**

Every requirement in this contract follows from an already-approved Owner decision — Service Access not now but mandatory before Workspaces; no Agent Model now but future compatibility preserved; Default Deny for cross-purpose reuse; disclosure defaults — or from the closed 006-A/006-B/006-C contracts, or from direct repository evidence. The contract remains truthful while deferring every implementation detail, so no decision is required to complete or accept it.

### O.2 Future Owner gates

Carried forward unchanged. **006-E creates no new gate.**

| Gate | Relevance to 006-E |
| --- | --- |
| **FOG-1** PI scope | Unaffected; not resolved |
| **FOG-2** PI feedback loops | Unaffected; not resolved |
| **FOG-3** Studies purpose | A Studies service would be subject to the entitlement model once both exist |
| **FOG-4** Verify secondary-use exception | Unaffected; entitlement to Verify is not authorization to reuse Verify data |
| **FOG-5** Supplier access context | A supplier access context, if ever approved, would be a distinct context — Service Access is Partner-directed and does not pre-empt it |
| **FOG-6** Retention / disposal | Governs retention of membership, entitlement, Service Access and audit records once they exist |

## P. Strategic Integration Compatibility

The Procurement Systems Integration Addendum is STRATEGICALLY APPROVED with **no implementation authority**. This contract is compatible with it and designs nothing.

1. **Integration Access ≠ Data Ownership.** Technical ability to reach an external system confers no ownership, and confers no membership, entitlement, permission, purpose authorization or disclosure authority. Integration sits *outside* the separation chain and may not short-circuit any link in it.
2. **A connector is not a principal class exemption.** If a future integration acts, it acts as a principal and is subject to PC-01 … PC-06 — including purpose boundary and disclosure rules.
3. **Entitlement is channel-neutral.** A service is available to a company or it is not; the ingestion channel does not alter availability.
4. **Service Access is channel-neutral.** It is defined by relationship, context, scope, permission and purpose — never by transport.
5. **External Request/Message Identity readiness is unaffected.** Nothing in this contract prevents future recognition of external identities for retry deduplication; equally, nothing here designs it.
6. **Integration failure is not procurement failure**, and is not a reason to relax any separation in section C.

## Q. Explicit Non-Goals

006-E does **not** create, design, authorize or imply: Service Access implementation, entitlement or subscription implementation, billing, Agent or non-human principal activation, Workspace implementation, runtime code, schema, migrations, database changes, new APIs, authorization implementation, RBAC administration surfaces, or integration.

It does **not** modify 006-A, 006-B, 006-C or the 006-D candidate; does not resolve FOG-1 … FOG-6; and does not alter any ownership, purpose or disclosure classification established upstream.

It does **not** authorize any new access. Where it defines semantics, those semantics are **constraints on a future implementation**, never present permissions.

## R. Acceptance Checklist

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Built from HEAD `c2f2ad4a37ef06995c75f08c5fdc52de24909271` | ✅ |
| 2 | All required separations preserved and stated non-implicatively | ✅ section C |
| 3 | Subscription → availability; permission → who may use; neither supplies purpose or disclosure | ✅ section C |
| 4 | Service Access semantics defined without schema design | ✅ section H, SA-01 … SA-14 |
| 5 | SCO workforce shared, Partner context isolated; no automatic membership or cross-company gain | ✅ section I |
| 6 | Multi-company model stated with truthful enforcement classification | ✅ section J |
| 7 | Entitlement absence recorded as NOT IMPLEMENTED, not invented | ✅ section F, incl. the warranty naming collision |
| 8 | Principal compatibility preserved without activating an Agent Model | ✅ section D |
| 9 | Verify system actor treated as evidence, not as permission to generalize | ✅ section D.2 |
| 10 | Workspace access semantics fixed so Stage 012 cannot invent them | ✅ section K, WS-01 … WS-08 |
| 11 | Every ENFORCED claim has concrete evidence | ✅ section L |
| 12 | Gaps recorded without exaggeration | ✅ section M, incl. explicit non-claims |
| 13 | Stage 011 requirements derived; no unnecessary HOW | ✅ section N |
| 14 | FOG-1 … FOG-6 preserved; no new gate | ✅ section O |
| 15 | Owner decisions required now: NONE | ✅ section O.1 |
| 16 | Integration compatibility without designing integration | ✅ section P |
| 17 | Nothing implemented | ✅ section Q |

## S. Evidence Index

### Application code

| Path | Evidence |
| --- | --- |
| `apps/api/src/modules/auth/auth.service.ts` | Login verifies password and ACTIVE status before session creation |
| `apps/api/src/modules/auth/session.service.ts` | SHA-256 token hash; 8h absolute / 30m idle; revocation; per-request status recheck |
| `apps/api/src/modules/auth/guards/auth.guard.ts` | Principal resolution per request |
| `apps/api/src/modules/auth/password.service.ts` | Credential verification path |
| `apps/api/src/modules/identity/users.service.ts` | User lookup by email; status surfaced |
| `apps/api/src/modules/identity/memberships.service.ts` | Server-side membership resolution; ambiguity rejection; foreign/suspended/revoked denial |
| `apps/api/src/modules/identity/membership-context.ts` | Resolved context carries `membershipId`, `userId`, `companyId`, `status: 'ACTIVE'` |
| `apps/api/src/common/tenant/tenant.guard.ts` | `x-sco-company-id` UUID validation then server-side resolution |
| `apps/api/src/common/tenant/partner-company.guard.ts` | Server-side company-type enforcement |
| `apps/api/src/modules/identity/sco-internal.guard.ts` | SCO workforce context: SCO-company membership + `sco.internal.manage` |
| `apps/api/src/modules/identity/membership-eligibility.service.ts` | Partnership-aware capability predicate — defined, not wired into any request path |
| `apps/api/src/modules/rbac/permissions.service.ts` | Permission join under tenant context |
| `apps/api/src/modules/rbac/permission.guard.ts` | Declarative route enforcement |
| `apps/api/src/database/tenant-transaction.service.ts` | `app.actor_id` / `app.tenant_id` transaction-local context |
| `apps/api/src/modules/audit/audit.service.ts` | Audit scope rules; `actor_user_id` only |

### Migrations

| Migration | Evidence |
| --- | --- |
| `0001_foundation` | `"User"`, `"Session"`, `"Company"`, `"CompanyMembership"` with `UNIQUE (userId, companyId)`; RLS baseline |
| `0002_security_gate_identity` | Actor-bootstrap read policy limited to the caller's own membership rows |
| `0003_runtime_role_least_privilege` | `sco_runtime` least privilege; mutation revoked on identity tables |
| `0004_rbac_audit_documents` | `"Role"`, `"Permission"` (`code UNIQUE`, no `company_id`), `"MembershipRole"`, `"RolePermission"` with `company_id` + FORCE RLS |
| `0015` / `0021` | `sco_internal_executor`; `internal_has_capability` |
| `0075_current_rbac_reconciliation` | RBAC reconciliation |
| `0084_verify_line_results_execution` | PRIN-2 — `verify_system_actor_id()`; system `"User"` row with sentinel hash; gateways with no caller-supplied actor |
| `0085_internal_gateway_security_remediation` | `sco.internal.manage` and capability-gated internal gateways; removal of GUC-as-boundary |

### Tests

| Path | Boundary proven |
| --- | --- |
| `apps/api/test/database/postgres-rls.integration.test.ts` | Cross-tenant denial as `sco_runtime`; no `BYPASSRLS`; no table ownership |
| `apps/api/test/database/rls-context.integration.test.ts` | Tenant context handling |
| `apps/api/test/integration/security-gate.integration.test.ts` | Full request path incl. disabled/suspended/revoked users, multi-membership selection, hostile company header |
| `apps/api/test/database/buy-side-trust-boundary.integration.test.ts` | Dual PARTNER+SUPPLIER membership accumulates no privilege; capability separation |
| `apps/api/test/database/sr01-sr02-internal-gateway-security.integration.test.ts` | Internal gateway capability enforcement |
| `apps/api/test/database/qualification-partnerships.integration.test.ts` | Partnership lifecycle as an SCO-operated record |

### Negative evidence (searched at this baseline, not found)

| Search | Result | Consequence |
| --- | --- | --- |
| `subscription`, `billing`, `licen[cs]e`, `seat` | **0 files** | EGAP-02 |
| `service access` | **0 files** | EGAP-03 |
| `workspace` | **0 files** | Section K is contract-only |
| `entitlement` as *service* entitlement | **Not found** — all occurrences are `warranty_entitlement` | EGAP-02; naming collision recorded |
| Agent / bot / service-account / machine-identity model | **Not found** | EGAP-08 |
| Login / logout audit action | **Not found** | EGAP-07 |
| Membership history table or `membership.*` audit action | **Not found** | EGAP-04 |
| RBAC administration endpoint | **Not found** | EGAP-05 |
| Purpose dimension in permission evaluation | **Not found** | EGAP-01 |
