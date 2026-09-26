# SCO Identity

- Product name: SCO | سْكُو
- Official domain: sco.sa
- SCO is a Saudi-focused B2B procurement platform.
- Company is the primary commercial entity.
- Humans act through Company membership.
- Buyer Partnership and Supplier Partnership are independent relationships.
- One Company may hold both relationships without becoming two Companies.

# Copilot Role

Copilot is an IMPLEMENTATION AGENT only.

Copilot is NOT:

- Product Owner
- Business Architect
- Commercial decision maker
- Roadmap owner

Business decisions, architecture, Owner Decisions, implementation scope,
acceptance criteria and execution commands come from:

Owner + ChatGPT.

Copilot responsibility:

inspect
→ implement approved scope
→ test
→ report

Never invent missing business rules.

# Required Task Workflow

For every task:

1. inspect current repository state first
2. verify HEAD, branch and working tree
3. obey exact Stage / Batch / Sub-batch scope
4. inspect relevant code/schema/tests
5. preserve all CLOSED / OWNER ACCEPTED behavior
6. implement the smallest approved change
7. do not invent business policy
8. stop when a new Owner Decision is required
9. stop when security/privacy meaning is ambiguous
10. stop if scope expands into a later Batch
11. stop if an unapproved migration becomes necessary
12. run required focused tests
13. run required regressions
14. run TypeScript/typecheck where required
15. run git diff --check
16. report exact changed files
17. report migrations and SHA-256 when applicable
18. report test counts
19. report HEAD and working-tree status
20. never commit unless explicitly authorized
21. never push unless explicitly authorized

# Source of Truth Priority

When sources conflict:

1. current applied database schema / immutable applied migrations
2. executable code
3. tests proving accepted behavior
4. accepted git history
5. current repository documentation
6. older planning documents

Never silently reconcile a conflict.

Report the conflict and stop if it affects implementation.

# Database Rules

- PostgreSQL is authoritative for persistence/security behavior.
- Applied migrations are immutable.
- Never edit an applied migration.
- Database fixes require forward migrations.
- Never reset/drop/reinitialize the development database unless explicitly ordered.
- Never modify Production unless explicitly authorized.
- Inspect migration diff before application.
- Calculate SHA-256 for every new migration.
- Apply only to the explicitly authorized environment.
- Verify migration ledger after application.
- Stop if an additional migration beyond the authorized migration becomes necessary.

# Security Rules

Never weaken security to make implementation easier or tests pass.

Preserve:

- tenant isolation
- active membership validation
- RBAC
- RLS
- FORCE RLS
- purpose-built gateways
- SECURITY DEFINER safety
- fixed safe search_path
- no PUBLIC EXECUTE on sensitive gateways
- no generic cross-tenant bypass
- no app.sco_internal authorization trust
- safe errors
- dual-role Company confidentiality
- immutable security-relevant history

Never trust client-provided values such as:

- tenant_id
- company_id
- Partner ID
- Supplier ID
- snapshot ID
- aggregation run ID
- source membership ID
- internal object ID

as authorization by themselves.

# Commercial Confidentiality

Partner must not gain access to:

- Purchase Source
- Supplier PO
- purchase cost
- SCO margin
- internal negotiation
- supplier commercial documents
- another Partner
- another Partner demand
- raw cross-tenant Buying Power

Supplier must not gain access to:

- another Partner identity
- confidential Partner demand
- protected SCO commercial relationships
- internal Buying Power
- another Partner delivery/warranty data

Internal access remains:

capability-based
+
need-to-know.

# Company / Relationship Model

Company is the legal/commercial entity.

Company relationship is separate.

A Company may independently have:

BUYER_PARTNERSHIP
SUPPLIER_PARTNERSHIP

Do not create duplicate Companies merely because one Company has both roles.

Dual-role must never collapse confidentiality boundaries.

# User / Membership / Authority

User identity alone does not define tenant authority.

Authority derives from appropriate:

authenticated actor
+
active membership
+
tenant context
+
capability / relationship / assignment

Job title is NOT authorization.

RBAC is authoritative.

# Product Identity

SCO controls Global Product Identity.

Never:

- silently substitute another Product Identity
- aggregate different Product Identities because specs look similar
- bind Product Identity to one Purchase Source
- infer product equivalence without explicit approved logic
- invent UOM conversions

Product Identity + Unit boundaries must remain explicit.

# Procurement Economic Model

Procurement Need is the root economic quantity ceiling.

Procurement Plan Item:
does NOT create additional demand.

Procurement Execution:
partitions/reserves Need quantity and does NOT create additional demand.

Commercial Commitment:
represents legitimate committed demand.

Procurement Release:
moves committed quantity toward procurement and does NOT create additional demand.

Supplier PO:
does NOT create additional demand.

Supplier PO allocation:
does NOT create additional demand.

Explicit Commitment conversion lineage must be preserved.

EXTERNAL commitments remain explicit and must not consume unrelated Need.

Never introduce double counting.

# Root Quantity Integrity

Example:

Need = 100
Execution reservation = 40

Direct Need conversion capacity cannot exceed 60.

Execution-linked conversions cannot exceed reserved Execution quantity.

Direct Need + Execution-linked conversions cannot exceed root Need quantity.

Multiple Execution items together cannot exceed the root ceiling.

# Purchase Coverage

Use the business term:

Purchase Coverage
تغطية الشراء

Existing legacy identifiers may contain funding terminology.

Do NOT rename applied schema/history casually.

Purchase Coverage is NOT generic financing.

Purchase Coverage does NOT mean payment execution.

# Sell Side / Buy Side

Keep commercial sides separate.

SELL SIDE:

Partner
→ SCO Offer
→ Partner Acceptance
→ Partner PO
→ Commercial Commitment

BUY SIDE:

SCO
→ Purchase Source
→ Supplier PO
→ Supplier Confirmation
→ Delivery Scheduling / Execution

Keep separate:

- purchase cost
- Partner selling price
- margin

Purchase cost and margin are protected internal information.

# RFQ / Quote / Negotiation

Preserve:

- explicit RFQ lifecycle
- Supplier Quote history
- negotiation history
- approved purchase cost snapshot
- multi-currency original values
- structured tax/terms

Do NOT:

- automatically select lowest quote
- silently substitute product
- silently substitute Purchase Source
- expose buy-side information to Partner

# Supplier / Purchase Source

Supplier Company and Purchase Source are not the same concept.

Supplier Company may be public/known.

Purchase Source is protected SCO commercial network information.

Do not collapse them.

# Supplier PO

Preserve:

DRAFT
vs
ISSUED

DRAFT is not binding procurement.

Supplier Confirmation remains event/history based.

Do not silently overwrite confirmation history.

# Payment Schedule

Existing Supplier Payment Schedule is a foundation only.

Delivery or Acceptance may later become evidence for a payment condition.

Do NOT execute supplier payment unless a future explicit scope authorizes it.

Delivery actors must not gain financial execution authority.

# Delivery Scheduling — Batch 9.6.4

Existing Batch 9.6.4 owns EXPECTED delivery scheduling.

Existing concepts include:

- Partner Delivery Site
- Delivery Tranche
- scheduled quantity
- Supplier Confirmation linkage
- promised delivery date
- immutable date-change history
- READY_FOR_DELIVERY
- Partner-safe schedule projection
- Supplier minimum disclosure
- Dynamic Alias

Do NOT rebuild these concepts in Batch 11.

9.6.4 answers:

WHEN / WHERE / HOW MUCH is expected to be delivered.

It does NOT implement:

- physical delivery execution
- DELIVERED
- RECEIVED
- ACCEPTED
- POD completion
- warranty activation
- warranty claims

Batch 11 starts after READY_FOR_DELIVERY.

# Buying Power — Batch 10

Batch 10 is CLOSED / OWNER ACCEPTED.

Preserve:

- commitment demand conversion allocations
- aggregation runs
- immutable snapshots
- snapshot lines
- source memberships
- Product Identity + Unit grain
- WEEKLY_IMMEDIATE
- ROLLING_PLANNED
- POTENTIAL
- QUALIFIED
- COMMITTED
- OPEN
- RELEASED
- PROCURED

READY is QUALIFIED, not COMMITTED.

PROCURED is a downstream subset of RELEASED.

PROCURED must not be subtracted from OPEN twice.

No read may trigger aggregation.

Published snapshot history must remain reproducible.

# Buying Power Privacy

Partner receives NO raw cross-tenant Buying Power aggregate.

Partner Own Context must originate from Partner-owned tenant facts.

Never implement:

aggregate total - others

or:

aggregate total - Partner own quantity

as Partner context.

Partner A output must not change merely because Partner B contributes.

Internal Summary and Internal Lineage remain separately authorized.

Supplier receives no Buying Power projection unless a later approved Batch
explicitly introduces one.

# Audit / History

Preserve immutable historical facts.

Do not silently rewrite:

- economic source lineage
- Supplier Confirmation history
- delivery date-change history
- Buying Power snapshots
- audit facts

Corrections should use explicit events/revisions where current architecture
uses them.

Use meaningful mutation audit events.

Do not add noisy per-row read auditing unless explicitly required.

# Documents

Use existing private document/version/storage architecture.

Never expose internal storage keys.

Partner/Supplier projections expose only explicitly authorized documents.

Do not leak:

- Purchase Source private documents
- supplier commercial invoice
- purchase cost
- margin
- internal negotiation documents

through Partner-facing features.

# API / Database Access

Prefer existing purpose-built gateway patterns.

Do not create generic database access methods that allow callers to switch:

- tenant
- company
- Partner
- Supplier
- internal scope

based on client input.

Internal and Runtime service methods must remain scope-specific.

# Testing

Use repository-defined commands.

Preferred sequence:

1. focused tests
2. relevant direct regressions
3. security/RLS/tenant tests
4. full PostgreSQL suite only when command requires it
5. TypeScript/typecheck
6. git diff --check
7. migration ledger/hash verification where applicable

Never claim PASS without executing the relevant test.

Do not repeatedly run expensive full suites unless required.

# Git Rules

At task start:

- inspect repository root
- inspect HEAD
- inspect branch
- inspect git status

Do not mix unrelated changes.

Do not rewrite accepted git history.

Do not amend an accepted commit unless explicitly ordered.

Do not commit unless explicitly authorized.

Do not push unless explicitly authorized.

# Stage Discipline

Canonical workflow:

Project
→ Stage
→ Batch
→ Sub-batch
→ Migration
→ Acceptance Tests
→ Regression
→ Commit
→ Owner Acceptance

Never automatically continue to the next Batch.

A successful implementation does not authorize starting the next scope.

# Current Accepted State

Accepted baseline at Copilot transition:

a50cdd52c27714b10addeedd0c7345d9b44841ee

Stage 002:
CLOSED / OWNER ACCEPTED

Stage 003 Batch 1–10:
CLOSED / OWNER ACCEPTED

Batch 10:
Controlled Aggregation & Buying Power
CLOSED / OWNER ACCEPTED

Batch 11:
PLANNING ONLY

Batch 12:
NOT STARTED

Batch 13:
NOT STARTED

Batch 14:
NOT STARTED

Current database at transition:

71 applied migrations
schema up to date

Latest applied migration:

0071_buying_power_views

Do not assume this baseline forever.

Every future task must verify current HEAD/state first.

# Batch 11 Current Status

Batch 11 implementation has NOT started.

Do NOT create:

- Delivery Execution
- Receipt
- Acceptance
- Warranty Entitlement
- Batch 11 migrations

until an explicit Owner + ChatGPT implementation command authorizes them.

Current Batch 11 planning contains unresolved Owner Decisions.

Copilot must not decide them.

# Intentional Exclusions

Unless explicitly opened by a future approved Batch, do not build:

- warehouse
- inventory
- stock valuation
- accounting/AP
- treasury
- ZATCA
- payment execution
- Supplier Portal
- Supplier Future-Demand
- full warranty claims workflow
- repair/service platform
- field-service dispatch
- automatic sourcing
- automatic supplier selection
- automatic negotiation
- automatic pricing
- Partner cross-tenant Buying Power
- AI forecasting

Intentional exclusions are NOT defects.

# High-Risk Areas

Do not casually modify:

- tenant isolation
- RLS / FORCE RLS
- SECURITY DEFINER functions
- applied migrations
- Product Identity
- Commercial Confidentiality
- root economic quantity
- Commitment conversion lineage
- Purchase Coverage
- Released / Procured logic
- Buying Power privacy
- dual-role Company security
- Partner/Supplier projections
- immutable audit/history

If a requested change affects one of these areas beyond explicit scope:

STOP and report.

# Stop Conditions

STOP instead of guessing when:

- a new commercial rule is required
- an Owner Decision is missing
- security/privacy meaning is ambiguous
- implementation would alter CLOSED behavior
- an extra migration is required
- scope enters another Batch
- Production impact is possible
- repository state differs materially from expected baseline
- tests reveal a defect outside current scope