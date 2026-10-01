# Stage 006 — Batch 006-C — Disclosure & Identity Matrix

## A. Contract Status & Authority

This document is the official **Disclosure & Identity Matrix** for SCO. It defines who may see what, in which context, at what identity/disclosure level, what must remain hidden, what may use an Alias, when real identity may be revealed, on what authorization basis, with what audit evidence, what is enforced today, and what remains future enforcement.

Batch 006-C is a **documentation / engineering contract batch only**. It implements nothing: no masking engine, no alias schema, no reveal API, no authorization guard, no audit trigger, no database schema, no migration, no code, no UI, no supplier portal or supplier context, no workspace, and no Stage 008 control.

Authority and inputs:

| Source | Status |
| --- | --- |
| Engineering baseline `3a6a3e83bb64ef273662c606a733477ee8fe961b` | Authoritative HEAD for all evidence |
| `docs/architecture/stage-006-domain-data-ownership-matrix.md` (006-A) | CLOSED — ownership axis, not reopened |
| `docs/architecture/stage-006-purpose-taxonomy-cross-purpose-flow-contract.md` (006-B) | CLOSED — purpose axis, not reopened |
| Approved Strategic Baseline and Strategic Baseline Addendum | Governing policy |
| Owner-approved Dynamic Identity Masking decision | Governing policy |

**Axis relationship.** 006-A answered *who owns it*. 006-B answered *for what purpose it may be used*. 006-C answers *at what identity level it may be disclosed to another party*. The three axes are independent: ownership does not imply purpose, and purpose does not imply disclosure. A flow may be ALLOWED under 006-B and still be HIDDEN or ALIAS under 006-C, because a permitted flow still carries a minimization and identity obligation.

**Owner-approved core rule of this batch.** Cross-party/context disclosure defaults to **ALIAS or HIDDEN** when real identity is not operationally necessary. Real identity may be revealed only for an approved operational need with auditable permission and purpose.

This evidence was built independently from the repository and approved policy. No external review conclusions were consumed.

## B. Scope

In scope: identity and disclosure rules across parties and contexts; disclosure levels; reveal conditions; supplier-facing and partner/project confidentiality; Verify disclosure boundary; Procurement Intelligence identifiability boundary; document-embedded identity; audit evidence for disclosure and reveal; current enforcement evidence and gaps; Stage 008 requirements as documentation only.

Out of scope: any implementation (section U), resolution of existing future Owner gates FOG-1 … FOG-6, and any reopening of 006-A or 006-B.

## C. Definitions

The authorization requires these concepts to remain distinct. They are used strictly as defined below.

| Term | Definition in this contract | Worked example from the repository |
| --- | --- | --- |
| **IDENTITY** | Who or what the actor or organization actually is | `partner_delivery_sites.company_id` and `operational_label` are the site's real identity |
| **ATTRIBUTION** | The minimum identity needed to attribute an action to an actor | `app.actor_id` and `audit_logs.actor_user_id` carry an actor UUID, not a profile |
| **DISCLOSURE** | What identity or data another party is permitted to receive | `supplier_delivery_disclosure_projection` defines exactly what a supplier may receive |
| **ALIAS** | A context-specific substitute identifier that stands in for real identity | `partner_delivery_sites.delivery_alias`, format `SCO-DST-XXXXXXXXXX` |
| **HIDDEN** | Identity withheld entirely; the recipient receives no substitute either | Partner company identity and project identity are absent from the supplier projection |
| **REVEAL** | A controlled transition from ALIAS/HIDDEN toward real identity | Site `location_details` and `receiving_contact` become non-NULL only at `READY_FOR_DELIVERY` |
| **PURPOSE** | Why a disclosure or reveal is permitted | Physical delivery cannot occur without a destination at the point of dispatch |
| **PERMISSION** | Who is authorized to perform or receive the disclosure | `supplier_po.delivery_schedule.read_assigned` held in an ACTIVE `type='SUPPLIER'` company |
| **AUDIT** | Evidence that the disclosure or reveal occurred under approved conditions | `partner_delivery_site.created` audit entry recording the generated alias |

**Attribution is not disclosure.** Attribution is inward-facing and serves accountability; disclosure is outward-facing and serves another party. An actor UUID appearing in an internal audit record is attribution. The same UUID resolved to a person's name and shown to a counterparty is disclosure, and is governed by this contract.

## D. Disclosure Levels

Four levels, plus one modifier that repository evidence genuinely supports.

| ID | Level | Meaning | Evidence that the level is real in this repository |
| --- | --- | --- | --- |
| **DL-0** | **REAL** | Real identity and details are visible to the recipient | Partner receives `site.operational_label` and `site.location_details` for its own site |
| **DL-1** | **MINIMIZED** | Only the minimum real attributes strictly necessary | Partner Verify result exposes 8 named fields and per-currency coverage, nothing more |
| **DL-2** | **ALIAS** | A contextual substitute identifier replaces real identity | Supplier receives `destination_alias`, never the site label or owner |
| **DL-3** | **HIDDEN** | Identity is not disclosed at all, with no substitute | Supplier receives no partner company identity and no project identity in any form |
| **DL-2R** | **ALIAS WITH CONDITIONAL REVEAL** *(modifier on DL-2)* | Alias is the steady state; specific real attributes become visible only when a defined operational state is reached | `CASE WHEN t.status='READY_FOR_DELIVERY' THEN site.location_details ELSE NULL END` |

**DL-2R is documented, not invented.** It is recorded as a *modifier* on DL-2 rather than a fifth independent level, because the repository implements exactly one localized instance of it and no general capability exists. Documenting it preserves an important real behaviour without implying a runtime masking engine.

Level ordering for minimization purposes: `DL-3 ⊂ DL-2 ⊂ DL-1 ⊂ DL-0`. A contract row always states the **highest** level permitted; disclosing less is always compliant.

## E. Identity Classes

| ID | Identity class | What it is | Where it lives (evidence) |
| --- | --- | --- | --- |
| **IC-1** | Platform user identity (natural person) | A human actor's real identity | `"User".id`, `"User".email` |
| **IC-2** | Company / organization identity | An organization as a directory entity | `"Company".id`, `name`, `type`, `status` |
| **IC-3** | Partner / customer identity | A company acting as procurement customer | `"Company"` where `type='PARTNER'`; `partner_company_id` on commitments and releases |
| **IC-4** | Supplier identity | A company acting as supply counterparty | `"Company"` where `type='SUPPLIER'`; `supplier_company_id` on quotes, sources, POs |
| **IC-5** | Commercial source identity | The specific purchasing channel SCO uses | `purchase_sources` (`source_code`, `branch_context`, `commercial_route`, `operational_context`), `purchase_source_contacts` |
| **IC-6** | Project identity | A partner's project, including its name and location context | `projects` (`code`, `name`, `location_context`), `project_id` references |
| **IC-7** | Site / destination identity | A physical receiving destination and its contact | `partner_delivery_sites` (`operational_label`, `location_details`, `receiving_contact`) with alias `delivery_alias` |
| **IC-8** | Actor attribution metadata | Minimum identity needed to attribute an action | `app.actor_id`, `audit_logs.actor_user_id`, `created_by`, `submitted_by`, `approved_by` |
| **IC-9** | Document-embedded identity | Identity carried *inside* file content or extracted data, independent of row-level ownership | `documents`/`document_versions` content behind `storage_key`; `procurement_document_lines` extracted values |

IC-9 is called out separately because row-level access control does not inspect content. A document may be lawfully reachable while its embedded identities remain undisclosable to a third party.

## F. Context / Party Model

### F.1 Parties

| Party | Repository representation | Access context today |
| --- | --- | --- |
| **Partner** | `Company.type='PARTNER'` + ACTIVE `CompanyMembership` | Implemented tenant context |
| **SCO operator** | `Company.type='SCO'` + `sco.internal.manage` + typed gateways | Implemented operator context |
| **Supplier** | `Company.type='SUPPLIER'` | **Data-layer predicates exist; no reachable access context** (see F.3) |
| **SCO system actor** | Fixed UUID from `verify_system_actor_id()` | Implemented, Verify only |

### F.2 Contexts and status

Contexts are the 006-B purposes, reused deliberately so disclosure traces to purpose rather than inventing a parallel model.

| Context | 006-B purpose | Status for disclosure purposes |
| --- | --- | --- |
| Partner-facing procurement | PUR-05, PUR-06 | IMPLEMENTED |
| SCO internal procurement | PUR-06 | IMPLEMENTED |
| Buy-side sourcing | PUR-07 | IMPLEMENTED |
| Supplier-facing processing | PUR-08 + delivery disclosure | **PARTIALLY IMPLEMENTED — projection defined, context unreachable** |
| Sell-side commercial offer | PUR-11 | IMPLEMENTED |
| Verify | PUR-14 | IMPLEMENTED |
| Procurement Intelligence / Buying Power | PUR-17 | PRECURSOR ONLY (buying power); PI not a named domain |
| Projects | PUR-04 | IMPLEMENTED |
| Engineering Studies / Advisory | PUR-18 | NOT IMPLEMENTED |
| Documents | PUR-15 | IMPLEMENTED |
| Audit / Security Evidence | PUR-16 | IMPLEMENTED |
| Delivery / Fulfilment | PUR-13 | IMPLEMENTED |
| Commercial Commitment / Payment | PUR-12 | IMPLEMENTED |

### F.3 Material finding — the supplier disclosure path is defined but unreachable

`supplier_delivery_projection_capability(p_actor, p_company)` requires an ACTIVE membership in an ACTIVE `Company` of `type='SUPPLIER'` holding `supplier_po.delivery_schedule.read_assigned`, and `supplier_delivery_disclosure_projection` additionally requires `current_setting('app.tenant_id') = source.supplier_company_id`.

So a supplier-facing disclosure contract **already exists in the database layer**, correctly alias-based. However 006-A established that there is no supplier authentication path, no supplier membership provisioning flow, and no supplier HTTP surface. A re-check at this baseline confirms no supplier controller exists.

Consequence for this contract: the supplier disclosure rules below are **contractually binding and already correctly shaped**, but they are currently **latent** — they describe a path that cannot be exercised. This is recorded as a finding, not a defect, and it makes FOG-5 (supplier access context) the gate that would activate them.

## G. Disclosure Principles

1. **Default to ALIAS or HIDDEN.** Cross-party/context disclosure of real identity requires operational necessity. Absent that necessity the default is ALIAS where a stable reference is needed, HIDDEN where it is not.
2. **Custody is not disclosure authority.** Data existing inside SCO creates no entitlement for any party to receive it in real-identity form.
3. **Participation is not entitlement.** A partner participating in procurement acquires no right to supplier identity, source, quote, buy-side cost, negotiation history, margin, internal pricing logic, or sourcing rationale.
4. **Need-to-know and minimization.** A recipient receives the minimum identity attributes required by the operation at hand, at the latest moment they are required.
5. **Reveal is an event, not a state.** A reveal is a bounded transition with a purpose, a permission, a recipient, a minimum attribute set, and an audit obligation.
6. **Attribution never implies disclosure.** Internal attribution metadata does not become disclosable because it exists.
7. **Alias must be opaque and non-derivable.** An alias must not encode or permit inference of the real identity it substitutes.
8. **Asymmetry is correct.** The owner of an identity may see it in REAL form while a counterparty sees ALIAS or HIDDEN. These are different rows in this matrix, never one rule.
9. **Purpose boundary still applies.** 006-B governs whether data may move at all; 006-C governs the identity level if it does. Both must be satisfied.
10. **Policy status is separate from technical enforcement.** Every material row reports both, and absence of a code path is never recorded as a purpose-aware disclosure enforcement engine.

## H. Disclosure & Identity Matrix

### H.1 Compact matrix

26 rows. "Level" is the highest disclosure level this contract permits. "Enforcement" reports current technical reality.

| ID | Source → Recipient | Identity classes at stake | Context | Level | Policy status | Current technical enforcement |
| --- | --- | --- | --- | --- | --- | --- |
| DIM-01 | Partner → SCO | IC-1, IC-3, IC-6, IC-7 | Need intake, projects | DL-0 REAL | ALLOWED | ENFORCED (tenant context; SCO operates the data under 006-A) |
| DIM-02 | SCO → Partner: own tenant data | IC-3, IC-6, IC-7 | Procurement, projects, delivery | DL-0 REAL | ALLOWED | ENFORCED (tenant RLS on `company_id`) |
| DIM-03 | SCO → Partner: execution status | — | Procurement operations | DL-1 MINIMIZED | ALLOWED | ENFORCED (coarse status mapping in `ExecutionService.partnerStatus`) |
| DIM-04 | SCO → Partner: commercial offer | — | Sell-side offer | DL-1 MINIMIZED | ALLOWED | ENFORCED (allowlisted `partner_offer_projection` + negative test) |
| DIM-05 | SCO → Partner: supplier identity | IC-4 | Any | DL-3 HIDDEN | DENIED BY DEFAULT | ENFORCED |
| DIM-06 | SCO → Partner: commercial source identity | IC-5 | Any | DL-3 HIDDEN | DENIED BY DEFAULT | ENFORCED |
| DIM-07 | SCO → Partner: buy-side cost / quote / negotiation | — | Buy-side sourcing | DL-3 HIDDEN | DENIED BY DEFAULT | ENFORCED |
| DIM-08 | SCO → Partner: margin / internal pricing logic / sourcing rationale | — | Pricing | DL-3 HIDDEN | DENIED BY DEFAULT | ENFORCED |
| DIM-09 | SCO → Supplier: destination | IC-7 | Delivery | DL-2R ALIAS with conditional reveal | ALLOWED | ENFORCED in the projection; context unreachable |
| DIM-10 | SCO → Supplier: partner identity | IC-3 | Any | DL-3 HIDDEN | DENIED BY DEFAULT | ENFORCED in the projection; context unreachable |
| DIM-11 | SCO → Supplier: project identity | IC-6 | Any | DL-3 HIDDEN | DENIED BY DEFAULT | ENFORCED in the projection; context unreachable |
| DIM-12 | SCO → Supplier: product, quantity, date | — | Delivery | DL-1 MINIMIZED | ALLOWED | ENFORCED in the projection; context unreachable |
| DIM-13 | SCO → Supplier: other partners' demand or aggregate position | IC-3, IC-6 | PI / buying power | DL-3 HIDDEN | DENIED BY DEFAULT | NOT ENFORCED (no code path exists) |
| DIM-14 | Supplier → SCO | IC-4, IC-5 | Buy-side sourcing | DL-0 REAL | ALLOWED | ENFORCED (SCO-internal tables, capability-gated) |
| DIM-15 | Partner → Supplier (direct) | all | Any | DL-3 HIDDEN | DENIED BY DEFAULT | NOT ENFORCED (no channel exists) |
| DIM-16 | Supplier → Partner (direct) | all | Any | DL-3 HIDDEN | DENIED BY DEFAULT | NOT ENFORCED (no channel exists) |
| DIM-17 | Partner A → Partner B | IC-1, IC-3, IC-6, IC-7 | Any | DL-3 HIDDEN | DENIED BY DEFAULT | ENFORCED (tenant RLS; cross-tenant denial tested) |
| DIM-18 | Project → Supplier | IC-6, IC-7 | Delivery | DL-2 ALIAS (site only) | ALLOWED only as alias | ENFORCED in the projection; context unreachable |
| DIM-19 | Supplier → Project context | IC-4, IC-5 | Projects | DL-3 HIDDEN | DENIED BY DEFAULT | ENFORCED (supplier tables revoked from `sco_runtime`) |
| DIM-20 | Verify → Partner (own result) | — | Verify | DL-1 MINIMIZED | ALLOWED | ENFORCED (two-layer allowlist, fail-closed) |
| DIM-21 | Verify → Procurement / Pricing / Offer / Supplier workflow | all | Cross-purpose | DL-3 HIDDEN | DENIED BY DEFAULT | NOT ENFORCED (no code path exists) |
| DIM-22 | Verify → PI | all | Cross-purpose | DL-3 HIDDEN | DENIED BY DEFAULT | NOT ENFORCED (no code path exists) |
| DIM-23 | Procurement → PI: aggregate | — | PI / buying power | DL-1 MINIMIZED, non-identifying | ALLOWED | ENFORCED by construction (aggregation key carries no company/project) |
| DIM-24 | Procurement → PI: identifiable lineage | IC-3, IC-6 | PI | DL-3 HIDDEN outside internal boundary | DENIED BY DEFAULT; exposure beyond internal boundary is FOG-1 | PARTIALLY ENFORCED (internal-only gateways; no disclosure mechanism) |
| DIM-25 | Audit → any commercial recipient | IC-1, IC-3, IC-4, IC-8 | Audit evidence | DL-3 HIDDEN | DENIED BY DEFAULT | NOT ENFORCED (no code path exists) |
| DIM-26 | SCO internal operator → internal operator (cross-capability) | IC-4, IC-5 | Buy-side sourcing | DL-0 REAL only within held capability | ALLOWED, capability-scoped | ENFORCED (granular capability separation, proven by test) |

**Level distribution:** DL-0 REAL 4 · DL-1 MINIMIZED 5 · DL-2 ALIAS 2 (one of which is DL-2R) · DL-3 HIDDEN 15 · total 26.

**Policy distribution:** ALLOWED 11 · DENIED BY DEFAULT 15 · total 26. No row requires a new Owner decision now.

### H.2 Detailed rows where detail matters

#### DIM-09 / DIM-10 / DIM-11 / DIM-12 — SCO → Supplier in delivery

This is the single richest piece of disclosure evidence in the repository and the model case for the Owner-approved rule.

- **What the supplier receives:** `tranche_id`, `destination_alias`, `product_identity_id`, `quantity`, `expected_date`, `tranche_status`, `location_details` *(conditional)*, `receiving_contact` *(conditional)*, `date_changed`.
- **What the supplier never receives:** partner company identity, project identity, the site's real `operational_label`, commitment or release identifiers, partner quantities beyond the tranche, or any partner commercial context.
- **Alias construction:** generated inside `internal_partner_delivery_site_create` as `'SCO-DST-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))`, stored `NOT NULL UNIQUE`. It is derived from a fresh random UUID, not from the partner, project or site, so it is opaque and non-derivable — satisfying principle G.7.
- **Conditional reveal:** `CASE WHEN t.status='READY_FOR_DELIVERY' THEN site.location_details ELSE NULL END`, and identically for `receiving_contact`. Before that state the supplier sees NULL.
- **Authorization basis:** ACTIVE membership in an ACTIVE `type='SUPPLIER'` company, permission `supplier_po.delivery_schedule.read_assigned`, plus `app.tenant_id` equal to the supplier company owning the purchase source.
- **Current technical enforcement:** the projection is ENFORCED as written and `REVOKE ALL … FROM PUBLIC` applies, with EXECUTE granted only to `sco_runtime`; the capability predicates are revoked from `sco_runtime` and `sco_internal_executor` directly. Direct table access is denied: tests assert `partner_delivery_sites`, `supplier_po_delivery_tranches` and `supplier_po_delivery_tranche_change_events` all reject runtime and executor reads with `permission denied`, and that aliases do not contain the partner identifier.
- **Qualification:** the supplier access context does not exist, so this path is latent (F.3).

#### DIM-02 vs DIM-09 — the asymmetry is the contract

For the *same* delivery site row:

| Recipient | Site name | Location | Contact | Owner identity |
| --- | --- | --- | --- | --- |
| Partner (owner) | `operational_label` — **REAL** | `location_details` — **REAL, unconditional** | n/a | own |
| Supplier (counterparty) | `delivery_alias` — **ALIAS** | **NULL until `READY_FOR_DELIVERY`** | **NULL until `READY_FOR_DELIVERY`** | **HIDDEN** |

This is the Owner-approved rule already operating: the owner sees real identity, the counterparty sees an alias, and real attributes appear only at the moment of operational necessity.

#### DIM-17 — Partner A → Partner B

Cross-tenant disclosure is HIDDEN at every identity class. Enforcement is the tenant RLS boundary: `FORCE ROW LEVEL SECURITY` with policies comparing `company_id` to `app.tenant_id`, a `NOBYPASSRLS` non-owning runtime role, and direct tests connecting as `sco_runtime` that prove cross-tenant SELECT/UPDATE/DELETE/INSERT denial, missing-context denial, context reuse, and `SET row_security = off` failure.

#### DIM-26 — operator-to-operator capability scoping

Real identity inside SCO is not uniformly visible to all SCO staff. Capability separation is granular and tested: an actor holding `rfq.read` retrieves an RFQ but receives `null` for purchase cost; an actor holding `purchase_cost.read` receives cost but `null` for the RFQ. Scoped supplier PO visibility additionally requires a valid source/category assignment, not merely a read permission.

## I. Reveal Matrix

A reveal is a bounded transition toward real identity. Each permitted category states operational necessity, purpose, authorization basis, minimum attributes, recipient, audit requirement, and scope/duration.

| ID | Reveal | Status |
| --- | --- | --- |
| RVL-01 | Destination details to supplier at dispatch readiness | **IMPLEMENTED** (state-gated) |
| RVL-02 | Verify raw content to an authorized SCO reviewer | **IMPLEMENTED** (consent + grant gated) |
| RVL-03 | Supplier identity to partner | **NOT PERMITTED** |
| RVL-04 | Partner/project identity to supplier | **NOT PERMITTED** by default |
| RVL-05 | Identifiable PI lineage beyond internal boundary | **FUTURE GATE — FOG-1** |
| RVL-06 | General alias→real reveal workflow | **NOT IMPLEMENTED** |

### RVL-01 — Destination reveal to supplier at dispatch readiness

| Element | Content |
| --- | --- |
| **Operational necessity** | Physical goods cannot be delivered without a destination and a receiving contact at the point of dispatch |
| **Purpose** | Delivery / fulfilment (PUR-13) only |
| **Authorization basis** | ACTIVE membership in ACTIVE `type='SUPPLIER'` company + `supplier_po.delivery_schedule.read_assigned` + `app.tenant_id` = owning supplier company + tranche state `READY_FOR_DELIVERY` |
| **Minimum attributes revealed** | `location_details` and `receiving_contact` for that one tranche's site. Nothing else changes level |
| **Recipient / context** | The specific supplier holding the assigned purchase order line |
| **Still hidden after reveal** | Partner identity, project identity, site `operational_label`, commitment/release identifiers, all commercial context |
| **Scope / duration** | Scoped to the single tranche and its state; the alias remains the destination's identifier throughout |
| **Audit requirement** | **Contractual requirement:** each state-gated destination reveal should be evidenced with actor, supplier company, tranche, and state at the time of reveal. **Current gap:** the projection is a read path and records no audit event; only site *creation* is audited |
| **Current enforcement** | ENFORCED as a state gate in SQL; latent because the supplier context is unreachable |

### RVL-02 — Verify raw content reveal to an authorized SCO reviewer

| Element | Content |
| --- | --- |
| **Operational necessity** | Human review of raw partner quote content, which is zero-access by default |
| **Purpose** | Verify (PUR-14) only; purpose is recorded per grant |
| **Authorization basis** | Partner consent (`human_review_consented_at`/`_by`) **and** an internally authorized grant recording purpose, scope, reason and authorization basis, time-bounded by `starts_at`/`expires_at`, revocable, and subject to `CHECK (authorized_by <> actor_user_id)` so the authorizer cannot be the accessor |
| **Minimum attributes revealed** | The raw content of the specific revision named by the grant |
| **Recipient / context** | The single named `actor_user_id` on the grant |
| **Scope / duration** | Bounded by grant scope and expiry; `CHECK (expires_at > starts_at)` |
| **Audit requirement** | Every open recorded in `verify_raw_content_access_events`, immutable against UPDATE and DELETE |
| **Current enforcement** | ENFORCED structurally: constraints, immutability and audit exist. No raw-content delivery mechanism is implemented, so the reveal is defined but not exercisable |

### RVL-03 — Supplier identity to partner — NOT PERMITTED

No operational necessity exists: SCO buys and negotiates in its own name and sells in its own name. There is no approved purpose, no authorization basis, and no minimum attribute set. Enforced today by table revocation and by the offer projection allowlist.

### RVL-04 — Partner/project identity to supplier — NOT PERMITTED by default

Need-to-know analysis shows suppliers do not require partner or project identity to fulfil an order: product, quantity, date and an aliased destination are sufficient, as the implemented projection demonstrates. Any future necessity would be a new disclosure decision, not an engineering judgement.

### RVL-05 — Identifiable PI lineage beyond the internal boundary — FUTURE GATE

Buying-power lineage is identifiable and currently internal. Exposure beyond that boundary falls under FOG-1 and is not resolved here.

### RVL-06 — General alias→real reveal workflow — NOT IMPLEMENTED

No general reveal API, approval workflow, reveal audit event type, or reveal authorization model exists. RVL-01 and RVL-02 are purpose-specific mechanisms, not a general capability. Recorded in section T as a Stage 008 requirement.

## J. Supplier-Facing Confidentiality

1. The **Internal Supply Network is SCO-internal** and is **not** a Partner Supplier Directory. Supplier identity, qualification, capability, purchase sources and source contacts are SCO-internal commercial facts.
2. A partner has **no entitlement by participation** to supplier identity, supplier source, supplier quote, buy-side cost, negotiation history, margin, internal pricing logic, or internal sourcing rationale.
3. **SCO is not a transparent agency layer.** It buys and negotiates in its own name and sells in its own name. Representing supplier terms to the partner is outside the commercial model.
4. **Enforcement today is strong and tested.** Fifteen buy-side and supply-network tables reject reads from the runtime role under every spoof combination — including `app.sco_internal='true'` combined with a valid `app.actor_id` — with SQLSTATE `42501`; known and random identifiers are denied identically so existence is not disclosed; and partner, supplier and dual-membership actors receive `null` from internal gateways. The partner offer projection is additionally guarded by a negative assertion that it must not match `/pricing|purchase|supplier|source|margin|overhead|contribution|approvalReason/i`.
5. **Direction matters.** Supplier → SCO is DL-0 REAL (DIM-14): SCO legitimately knows its counterparties in full. SCO → Partner for the same identity class is DL-3 HIDDEN (DIM-05). These are separate rows and must never be collapsed.

## K. Partner / Project Confidentiality

Classification of each attribute named in the authorization, toward a supplier-facing recipient.

| Attribute | Identity class | Level toward supplier | Rationale |
| --- | --- | --- | --- |
| Partner legal identity | IC-3 | DL-3 HIDDEN | Not required to fulfil an order |
| Partner operational identity | IC-3 | DL-3 HIDDEN | Not required; alias carries the operational reference |
| Project identity (`code`, `name`) | IC-6 | DL-3 HIDDEN | Not required; no project reference appears in the supplier projection |
| Project location (`location_context`) | IC-6 | DL-3 HIDDEN | Superseded by the site alias; the destination is a separate controlled attribute |
| Site destination | IC-7 | DL-2R ALIAS with conditional reveal | Alias suffices until dispatch; address is revealed only at `READY_FOR_DELIVERY` |
| Receiving contact | IC-7 | DL-2R, revealed with the destination | Same necessity and same gate |
| Quantities | — | DL-1 MINIMIZED — tranche quantity only | A supplier needs its own tranche quantity, not the partner's committed total |
| Drawings | IC-9 | DL-3 HIDDEN | No mechanism discloses document content to a supplier; embedded identity risk is high |
| BOQ | IC-9 | DL-3 HIDDEN | Procurement documents are tenant-scoped; extracted lines remain in partner context |
| Procurement plans | — | DL-3 HIDDEN | Plans are partner-owned demand planning, irrelevant to fulfilment |
| Schedules (partner-level) | — | DL-3 HIDDEN; tranche date only is DL-1 | A supplier needs its own expected date, not the partner's schedule |
| Commercial intent | — | DL-3 HIDDEN | Commercial context is SCO-internal by the commercial model |

**Need-to-know result.** Supplier-facing processing requires: product identity, tranche quantity, expected date, tranche status, an aliased destination, and — only at dispatch readiness — the address and receiving contact. Every other partner and project attribute is unnecessary and therefore defaults to HIDDEN under the Owner-approved rule. The implemented projection already matches this result exactly, which is strong evidence that the contract reflects intended design rather than retrofitting it.

## L. Verify Boundary

Verify remains independently bounded and must **not** become an identity-disclosure bridge.

1. **Partner-facing disclosure is DL-1 MINIMIZED and closed-set.** The result projection exposes exactly `requestId`, `revisionId`, `runId`, `resultId`, `status`, `classification`, `finalizedAt`, and per-currency coverage counts and percentages. A test asserts the DTO key set exactly and asserts no confidential pattern appears.
2. **Nothing identity-bearing about third parties is present.** No supplier identity, supplier cost, purchase source, negotiation history or evidence identifier is selected by the gateway, so no such value exists for a service layer to leak.
3. **Verify must not disclose identity into Procurement, PI, Pricing, Commercial Offer or Supplier workflow** (DIM-21, DIM-22). No code path exists; the denial is policy plus absence, not a purpose-aware engine.
4. **Raw content is the most restricted class** and is governed by RVL-02.
5. **Ambiguity fails closed**, so the absence of a result discloses nothing about whether a request exists, is foreign, or is merely unresolved — identical zero-row responses in all cases.
6. **Any future secondary-use exception remains subject to FOG-4** and separate Owner approval. This batch neither resolves nor narrows that gate.

## M. Procurement Intelligence Boundary

1. **Aggregate output is non-identifying by construction.** `buying_power_snapshot_lines` is keyed by `(snapshot_id, product_identity_id, unit_id)` and carries no `company_id` and no `project_id`. This is a structural property, not a policy promise (DIM-23).
2. **Lineage is identifiable and stays internal.** `buying_power_snapshot_source_memberships` retains `source_type` and source identifiers that trace back to partner-identifiable records. It remains inside the internal boundary (DIM-24).
3. **This batch does not authorize lineage exposure**, and does not resolve FOG-1 or FOG-2.
4. **No partner-facing or supplier-facing intelligence disclosure exists**, and none is authorized here (DIM-13).
5. **Storage is not disclosure authority.** Partner- or project-identifiable data does not become disclosable, or become intelligence input, merely because SCO holds it.

## N. Documents & Embedded Identity

Documents are assets, not universal disclosure rights. Six distinct questions must be answered separately for any document.

| Facet | Question | Default level cross-party | Evidence / note |
| --- | --- | --- | --- |
| **Existence** | May the recipient know the document exists? | DL-3 HIDDEN | No cross-party document listing exists |
| **Metadata** | May they see filename, type, size? | DL-1 MINIMIZED, owner/authorized context only | Metadata response returns filename, MIME type, size only |
| **Ownership** | May they learn which company owns it? | DL-3 HIDDEN cross-party | `company_id` is tenant-scoped |
| **Content** | May they read the bytes? | DL-3 HIDDEN cross-party | Content released only to an authorized purpose; `storage_key` never disclosed |
| **Extracted data** | May they receive structured extraction? | DL-3 HIDDEN cross-party | `procurement_document_lines` are tenant-scoped |
| **Embedded identity (IC-9)** | May identities *inside* the content be exposed? | DL-3 HIDDEN | **Not addressed by any current control** |
| **Downloadable / exportable copy** | May they retain a copy? | DL-3 HIDDEN cross-party | No export control, watermarking or expiring access exists |

**The decisive rule:** permission to access a document is **not** permission to expose the identities embedded in it to another party. Row-level access control operates on `company_id` and `access_scope`; it does not inspect content. A drawing or BOQ may name a partner, a project, a site or a person, and no current mechanism detects or redacts that. This is recorded as enforcement gap EG-05.

Scope partitioning that does exist: `documents.access_scope ∈ {TENANT, SCO_INTERNAL}` with the tenant policy requiring `access_scope='TENANT'`, so an internally-scoped document is unreachable through the tenant path even though the row carries that company's `company_id`. Verify raw and evidence documents are additionally constrained by triggers to the same company as the owning Verify request.

## O. Audit Requirements

Audit and security evidence is **not** a commercial disclosure dataset, and no commercial reuse of it is authorized (DIM-25).

Required audit evidence for disclosure and reveal decisions, stated as contract:

| Event | Required evidence | Current state |
| --- | --- | --- |
| Alias creation | Actor, owning company, generated alias, correlation | **EXISTS** — `partner_delivery_site.created` records `companyId` and `alias` |
| Destination reveal to supplier (RVL-01) | Actor, supplier company, tranche, state at reveal, timestamp | **GAP** — read-path projection emits no audit event |
| Verify raw content reveal (RVL-02) | Grant, revision, actor, timestamp | **EXISTS** — `verify_raw_content_access_events`, immutable |
| Partner Verify result read (DIM-20) | Actor, company, request | **GAP** — SELECT-only gateway emits no audit event |
| Any future alias→real reveal (RVL-06) | Full six-element record per section I | **NOT IMPLEMENTED** |
| Denied disclosure attempt | Actor, target, reason | **GAP** — denials surface as SQL permission errors, not as disclosure-audit events |

Two structural notes carried forward from 006-B without reopening it: `audit_logs` is append-only by grant and convention rather than by a mutation-rejecting trigger, and audit records the action rather than the purpose, so a disclosure cannot be reconstructed purpose-first from audit alone.

## P. Current Enforcement Evidence

Where this contract is genuinely enforced today, with the evidence that proves it.

| Area | Evidence |
| --- | --- |
| Cross-tenant identity isolation | FORCE RLS with `app.tenant_id` policies; `NOBYPASSRLS` non-owning runtime role; direct `sco_runtime` tests covering cross-tenant SELECT/UPDATE/DELETE/INSERT, missing context, context reuse and `SET row_security = off` |
| Supplier/source/cost confidentiality toward partner | Fifteen buy-side and supply-network tables denied under all six spoof combinations with SQLSTATE `42501`; identical denial for known and random identifiers; `null` returned to partner/supplier/dual actors from internal gateways |
| Sell-side offer minimization | Allowlisted `partner_offer_projection` plus a negative assertion forbidding pricing/purchase/supplier/source/margin/overhead/contribution/approval-reason patterns |
| Destination aliasing toward supplier | `delivery_alias NOT NULL UNIQUE`, random-UUID-derived, asserted to not contain the partner identifier; supplier projection returns alias only |
| State-gated destination reveal | `CASE WHEN t.status='READY_FOR_DELIVERY' …` for both `location_details` and `receiving_contact` |
| Delivery table lockdown | `partner_delivery_sites`, `supplier_po_delivery_tranches` and `supplier_po_delivery_tranche_change_events` reject direct runtime and executor reads with `permission denied`; runtime INSERT of a forged alias is rejected |
| Verify partner minimization | Two-layer allowlist, exact DTO key assertion, fail-closed on ambiguity, SELECT-only owner role with tenant-scoped `FOR SELECT` policies |
| Verify raw-access control | Consent fields, grant constraints including `authorized_by <> actor_user_id` and `expires_at > starts_at`, immutable access events |
| PI aggregate non-identifiability | Aggregation key carries no company or project column |
| Operator capability scoping | Granular capability separation proven by test; scoped supplier PO visibility additionally requires a valid source/category assignment |
| Document scope partition | `access_scope` check in the tenant policy; `storage_key` never returned; Verify same-company document triggers |

## Q. Enforcement Gaps

| ID | Gap | Consequence |
| --- | --- | --- |
| **EG-01** | **No general identity-masking engine.** Aliasing exists in exactly one place — delivery sites. Any new cross-party surface would have to re-implement masking by hand | A future surface could disclose real identity without any shared mechanism objecting |
| **EG-02** | **No general reveal mechanism.** RVL-01 and RVL-02 are bespoke. There is no reveal API, approval workflow, reveal audit event type, or reveal authorization model | Reveals cannot be governed uniformly, and new reveals would be ad hoc |
| **EG-03** | **Reveal and disclosure reads are largely unaudited.** The state-gated destination reveal and the partner Verify result read emit no audit event | One cannot evidence after the fact who received which identity attributes and when |
| **EG-04** | **Several denials rest on absence of a code path**, notably Verify→commercial, Verify→PI, audit→commercial, and partner↔supplier direct channels | Correct today; would not reject a future deliberately-written path |
| **EG-05** | **Embedded identity (IC-9) is uncontrolled.** No mechanism inspects or redacts identities inside document content or extracted data | A lawfully accessible document can carry identities that this contract forbids disclosing |
| **EG-06** | **Supplier disclosure path is latent.** Correct alias-based rules exist in SQL but no supplier access context can reach them | Rules are unexercised and unvalidated end-to-end; activation depends on FOG-5 |
| **EG-07** | **No disclosure-level concept exists in the data model.** REAL/MINIMIZED/ALIAS/HIDDEN are contract vocabulary only | Enforcement cannot be expressed or verified declaratively |
| **EG-08** | **No alias lifecycle rules.** Aliases are created once and never rotated, retired or re-scoped; no uniqueness-per-recipient or per-context notion exists | Long-lived aliases accumulate correlation risk across time |

None of these gaps is a defect in a closed batch. They are the difference between a contract and an enforcement engine, and they are the substance of section T.

## R. Owner Decisions Required Now

**NONE.**

Every row in this matrix is determined by the Owner-approved default (ALIAS or HIDDEN absent operational necessity), by the approved Strategic Baseline and Addendum, by the already-closed 006-A and 006-B contracts, or by direct repository evidence. No new Owner decision is required to define the **current** disclosure contract, and this batch manufactures none.

## S. Future Owner Gates

Existing gates from 006-B are carried forward unchanged and unresolved. 006-C adds no new gate.

| Gate | Area | Relevance to 006-C |
| --- | --- | --- |
| **FOG-1** | Procurement Intelligence scope | Governs RVL-05 and DIM-24 — identifiable lineage exposure beyond the internal boundary |
| **FOG-2** | PI feedback loops | Unaffected by this batch; not resolved |
| **FOG-3** | Studies purpose definition | Disclosure rules for Studies cannot be written until the purpose exists |
| **FOG-4** | Verify secondary-use exception | The default denial is already Owner approved; only an exception needs a decision |
| **FOG-5** | Supplier access context | **The activating gate for the currently latent supplier-facing disclosure path.** DIM-09 … DIM-12, DIM-18 and RVL-01 become live only when a supplier context exists. This contract's validity and closure do not depend on FOG-5 |
| **FOG-6** | Retention / disposal policy | Governs how long aliases, reveal evidence and disclosure audit are retained |

## T. Stage 008 Requirements

Requirements only. No design, schema, migration, guard, API or code is specified or authorized here.

| ID | Requirement | Derived from |
| --- | --- | --- |
| **R8-01** | Disclosure levels must be representable as first-class engineering concepts so a surface can declare the level it emits | EG-07 |
| **R8-02** | A general identity-masking capability must exist so aliasing is not re-implemented per surface | EG-01 |
| **R8-03** | Alias generation must remain opaque and non-derivable, and alias lifecycle (scope, rotation, retirement, per-context uniqueness) must be definable | EG-08, G.7 |
| **R8-04** | A general reveal mechanism must enforce the six-element record: necessity, purpose, authorization basis, minimum attributes, recipient/context, scope/duration | EG-02, section I |
| **R8-05** | Disclosure and reveal events must be auditable as such, distinctly from ordinary action audit | EG-03, section O |
| **R8-06** | Denied disclosure attempts must be observable as disclosure-audit events, not only as SQL permission errors | EG-03 |
| **R8-07** | Flow-level enforcement must be able to reject a denied disclosure even where technical privilege exists | EG-04 |
| **R8-08** | Embedded identity in document content and extracted data must be classifiable so IC-9 can be governed | EG-05 |
| **R8-09** | Supplier-facing disclosure rules must be validated end-to-end before or as a supplier context is introduced | EG-06, FOG-5 |
| **R8-10** | Identity-class classification must be available so minimization can be evaluated rather than asserted | sections E, M |

## U. Explicit Non-Goals

006-C does **not** create, design or authorize: a masking engine; an alias schema; a reveal API; an authorization guard; an audit trigger; database schema; a migration; application code; UI; a supplier portal or supplier access context; Digital Workspaces; or any Stage 008 control.

It does **not** modify 006-A or 006-B, does not resolve FOG-1 … FOG-6, does not reopen any closed batch, does not alter any purpose classification from 006-B, and does not alter any ownership classification from 006-A.

It does **not** authorize any new disclosure. Where this document records a level, it records the **maximum** permitted; it never widens an existing boundary.

## V. Acceptance Checklist

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Built from HEAD `3a6a3e83bb64ef273662c606a733477ee8fe961b` | ✅ |
| 2 | Identity, attribution, disclosure, alias, hidden, reveal, purpose, permission and audit kept distinct | ✅ section C |
| 3 | Disclosure levels defined with evidence, including any additional supported level | ✅ section D, DL-0 … DL-3 plus DL-2R |
| 4 | Identity classes enumerated and located in evidence | ✅ section E, IC-1 … IC-9 |
| 5 | All required contexts covered with precise current/future status | ✅ section F.2 |
| 6 | All required party relationships classified from evidence | ✅ section H, 26 rows |
| 7 | Commercial confidentiality preserved; SCO not represented as a transparent agency layer | ✅ section J |
| 8 | Partner/project attributes classified individually under need-to-know | ✅ section K |
| 9 | Dynamic Identity Masking: current state, strategic contract, reveal conditions, default | ✅ sections D, H.2, I, G.1 |
| 10 | Verify isolation preserved; no identity bridge; FOG-4 untouched | ✅ section L |
| 11 | PI aggregate/lineage distinction preserved; lineage exposure not authorized; FOG-1/FOG-2 not resolved | ✅ section M |
| 12 | Document facets separated, including embedded identity | ✅ section N |
| 13 | Audit evidence required for disclosure/reveal; no commercial reuse authorized | ✅ section O |
| 14 | Policy status separated from current technical enforcement on every material row | ✅ sections H, P, Q |
| 15 | Absence of a code path never classified as a purpose-aware enforcement engine | ✅ EG-04 |
| 16 | No manufactured current Owner blockers | ✅ section R — NONE |
| 17 | Existing future gates respected and unresolved | ✅ section S |
| 18 | Stage 008 documented as requirements only | ✅ section T |
| 19 | Nothing implemented | ✅ section U |

## W. Evidence Index

### Migrations

| Migration | Disclosure evidence |
| --- | --- |
| `0001_foundation`, `0002_security_gate_identity`, `0003_runtime_role_least_privilege` | IC-1, IC-2; tenant isolation baseline; runtime least privilege |
| `0004_rbac_audit_documents` | IC-8, IC-9; audit scope; document and version tenant policies |
| `0009_rolling_planning` | IC-6 — `projects` with `code`, `name`, `location_context`; tenant policies |
| `0011_supplier_network`, `0013_rfq_quotes_purchase_cost` | IC-4, IC-5 — supplier and purchase source identity |
| `0020_supplier_quote_document_access_isolation` | `documents.access_scope`; `get_supplier_quote_document` capability gate |
| `0028_partner_offer_revisions` | DIM-04 — `partner_offer_projection` allowlist; DIM-05 … DIM-08 denial |
| `0040_supplier_po_scoped_visibility_gateways` | DIM-26 — scoped operator visibility |
| `0058_delivery_site_tranche_foundation` | **IC-7 and the alias itself** — `partner_delivery_sites.delivery_alias NOT NULL UNIQUE`; alias generation inside `internal_partner_delivery_site_create`; permission `supplier_po.delivery_schedule.read_assigned` |
| `0059_delivery_internal_read_gateways` | Internal delivery read gateways exposing `delivery_alias` |
| `0060_partner_supplier_delivery_projections` | **The core disclosure evidence** — `partner_delivery_projection_capability` and `supplier_delivery_projection_capability`; `partner_delivery_projection_list` (REAL label and location to owner); `supplier_delivery_disclosure_projection` (alias plus state-gated reveal); `REVOKE ALL … FROM PUBLIC` and narrow EXECUTE grants |
| `0061_buying_power_foundation` | DIM-23, DIM-24 — non-identifying aggregate key; identifiable lineage table |
| `0073_partner_delivery_receipt_acceptance_discrepancy`, `0076_warranty_entitlement_foundation` | Partner-facing delivery and warranty projections |
| `0082_verify_foundation` | RVL-02 — raw-review grants, consent fields, immutable access events |
| `0084_verify_line_results_execution` | Fixed SYSTEM actor identity; Verify gateway roles |
| `0085_internal_gateway_security_remediation` | DIM-05 … DIM-08, DIM-19 — revocation of supply-network tables from `sco_runtime` |
| `0086_partner_verify_result_read` | DIM-20 — minimized Verify partner projection |

### Application code

| Path | Disclosure evidence |
| --- | --- |
| `apps/api/src/common/tenant/tenant.guard.ts`, `partner-company.guard.ts` | Party and company-type determination |
| `apps/api/src/modules/identity/memberships.service.ts` | Server-derived context; ambiguity rejected |
| `apps/api/src/modules/identity/execution.service.ts` | DIM-03 — coarse partner status mapping |
| `apps/api/src/modules/verify/partner-verify.service.ts` | DIM-20 — allowlisted DTO |
| `apps/api/src/modules/documents/supplier-quote-document.service.ts` | `storage_key` non-disclosure |
| `apps/api/src/modules/audit/audit.service.ts` | Audit scope rules; secret filtering |

### Tests

| Path | Disclosure boundary proven |
| --- | --- |
| `apps/api/test/database/supplier-delivery-tranche-foundation.integration.test.ts` | Alias format `^SCO-DST-[A-F0-9]{10}$`; alias does not contain the partner identifier; direct runtime/executor access denied; forged-alias INSERT denied |
| `apps/api/test/database/supplier-delivery-projection.integration.test.ts` | Supplier projection key set exactly `date_changed, destination_alias, expected_date, location_details, product_identity_id, quantity, receiving_contact, tranche_id, tranche_status`; alias prefix asserted; aliases non-authoritative; direct partner/runtime access blocked |
| `apps/api/test/database/buy-side-trust-boundary.integration.test.ts` | Supplier/source/cost confidentiality under all spoof combinations; identical denial for known and random identifiers |
| `apps/api/test/database/partner-offer-revisions.integration.test.ts` | Offer projection excludes pricing, purchase, supplier, source, margin, overhead, contribution, approval reasoning |
| `apps/api/test/database/partner-verify-result.integration.test.ts` | Verify DTO key set and confidential-pattern absence |
| `apps/api/test/database/postgres-rls.integration.test.ts`, `rls-context.integration.test.ts` | DIM-17 cross-tenant denial |
| `apps/api/test/database/supplier-po-scoped-visibility.integration.test.ts` | DIM-26 scoped operator visibility |
| `apps/api/test/database/warranty-entitlement-foundation.integration.test.ts` | `storage_key` absent from partner projection |

### Negative evidence (searched at this baseline, not found)

| Search | Result | Contract consequence |
| --- | --- | --- |
| Supplier HTTP controller or supplier authentication path | **Not found** | EG-06; supplier disclosure path is latent |
| General masking / pseudonymisation / unmask / reveal workflow terms | **Not found** outside the delivery alias | EG-01, EG-02 |
| Watermarking, export control, expiring access, retention, disposal | **Not found** | Section N; FOG-6 |
| References to `verify_*` outside `0082`–`0086` and `modules/verify` | **Not found** | DIM-21, DIM-22 rest on absence (EG-04) |
| Any disclosure-level column, enum or token | **Not found** | EG-07 |
