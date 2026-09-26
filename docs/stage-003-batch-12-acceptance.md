# Stage 003 Batch 12 Acceptance

Status: CLOSED / READY FOR OWNER ACCEPTANCE

Batch 12 closes the Supplier Future-Demand Framework as an internal-only,
indicative, non-binding commercial planning foundation. It does not create or
execute demand, procurement, payment, inventory, delivery, or warranty state.

## Approved Sub-batches

- 12-A: Framework core, immutable revisions, scope lines, lifecycle, and
  internal gateways.
- 12-B: Fixed and tiered purchase pricing, explicit currency and tax treatment,
  indicative capacity, and sanitized Buying Power provenance.
- 12-C: Security, confidentiality, adversarial access, and spoofing hardening.
- 12-D: Documentation, final verification, and Batch closure.

## Owner Decisions

- `OD-12-01`: A Framework starts INDICATIVE and NON-BINDING.
- `OD-12-02`: Quantity is an indicative ceiling only.
- `OD-12-03`: Demand provenance permits QUALIFIED and, separately, COMMITTED;
  POTENTIAL is excluded.
- `OD-12-04`: A Framework binds explicitly to Supplier Company, Supplier
  Partnership, and Purchase Source.
- `OD-12-05`: Scope uses exact SCO Product Identity and Unit only.
- `OD-12-06`: Each revision has explicit `effective_from` and
  `effective_until` dates.
- `OD-12-07`: The pricing foundation supports FIXED and TIERED only; indexed
  pricing is deferred.
- `OD-12-08`: Acceptance does not reserve capacity.
- `OD-12-09`: Procurement use is advisory only; no automatic Procurement
  Release or Supplier PO is created.
- `OD-12-10`: Activation requires SCO internal approval and Supplier acceptance
  evidence.
- `OD-12-11`: EXPIRED is derived from `effective_until`.
- `OD-12-12`: Batch 12 is INTERNAL-FIRST. It has no Supplier Portal or Supplier
  runtime access.
- `OD-12-13`: A signed or approved commercial document is legal authority;
  structured SCO data is its operational representation. A mismatch blocks
  activation or use.
- `OD-12-14`: A Framework price is not Supplier PO price evidence.
- `OD-12-15`: Batch 12 does not disclose Supplier demand.
- `OD-12-16`: The lifecycle is DRAFT, INTERNAL_APPROVED, OFFERED, and ACCEPTED;
  SUPERSEDED and TERMINATED are final events, while ACTIVE and EXPIRED are
  derived states.

## Implemented Scope and Integrity

Frameworks have immutable revisions, exact Product Identity and Unit scope,
explicit effective dates, and explicit Supplier Company, Supplier Partnership,
and confidential Purchase Source binding. The supported purchase-side terms are
FIXED pricing and deterministic TIERED pricing with explicit currency and
minimal tax representation. Capacity periods are positive indicative quantities
with deterministic overlap protection; they are neither reserved nor consumed.

The Framework creates no Procurement Need, Commercial Commitment, Procurement
Release, Supplier PO, Purchase Coverage, payment, accounting, inventory,
delivery, or warranty state. Its price neither overwrites nor becomes evidence
for Supplier Quotes, negotiation history, final purchase cost, or Supplier PO
pricing. Buy-side and sell-side remain separate; SCO selling price and margin
are outside Batch 12.

Buying Power provenance stores only an eligible published snapshot reference,
snapshot-line reference, and the permitted QUALIFIED or COMMITTED signal class.
It excludes POTENTIAL and does not disclose Partner composition, Need or project
identifiers, source memberships, quantities, or source lineage.

## Security and Confidentiality

All eight Batch 12 protected tables use RLS and FORCE RLS. Both runtime and the
internal executor lack intended direct table SELECT access. Purpose-built
SECURITY DEFINER gateways have a fixed `pg_catalog, public` search path, no
PUBLIC EXECUTE, no runtime EXECUTE, and explicit internal capability checks.
`app.sco_internal` is not an authorization signal.

Partner access is zero. Supplier runtime access is zero. Actual dual-role
Company access, tenant, actor, company, and `app.sco_internal` spoofing, and
identifier guessing are denied. Purchase Source, purchase-side price, capacity,
and Buying Power provenance remain confidential internal information.

Supplier acceptance evidence reuses the private document/version architecture:
both references are required together and must be SCO_INTERNAL and AVAILABLE.
Batch 12 gateways do not expose storage keys. Successful changes preserve
immutable history and use idempotency/concurrency protections.

## Intentional Exclusions

Batch 12 does not implement a Supplier Portal, Supplier Future-Demand view,
Supplier demand disclosure, indexed pricing, automatic sourcing, automatic
selection, automatic negotiation, automatic pricing, automatic Procurement
Release, automatic Supplier PO creation, capacity reservation or consumption,
warehouse, inventory, accounting, AP, treasury, payment execution, delivery,
warranty, or Stage 004 work.

## Migration Baseline

- Latest migration: `0081_supplier_future_demand_framework_tier_ordinality_fix`.
- Filesystem migrations: 81, each with `migration.sql`.
- `0077_supplier_future_demand_framework_core` SHA-256:
  `83e3222ca4bdefe8af420112fa354cad40ffd248ac0e4ddb8f899edd1576bf3e`.
- `0078_supplier_future_demand_framework_immutability_fix` SHA-256:
  `8d699d2eb21f288aafbbc2b0730dd61bdab4249809ea6761ad0524a744aa6c09`.
- `0079_supplier_future_demand_framework_commercial_terms` SHA-256:
  `2e241a65aaf6af29997cd134d0adb99ef8a55c3c4736534b79262235c884e266`.
- `0080_supplier_future_demand_framework_gateway_terminated_at_fix` SHA-256:
  `7775c2669300facdd00a9d64ea6927f2657e66d193ae5cdb4615afa89e40c052`.
- `0081_supplier_future_demand_framework_tier_ordinality_fix` SHA-256:
  `daddd0738e60acad19f0769107feb85df082155c079b3f5b786b78feb2592d10`.
- No `0082` exists.

The Development migration ledger has four accepted historical DB-only entries
that are not present in the current filesystem. This legacy Development
baseline is not modified, recreated, cleaned, or treated as a Batch 12 failure.

## Verification Evidence

- Batch 12 focused security suites: 11 PostgreSQL suites / 59 tests passed.
- Explicit Batch 12 adversarial commercial/security suite: 1 suite / 6 tests
  passed.
- Relevant PostgreSQL regressions: 40 suites / 314 tests passed.
- Fresh database verification applied migrations 0001 through 0081 and the
  repository seed, passed the security-gate integration suite (1 suite / 18
  tests) and Batch 12 core/commercial suites (2 suites / 10 tests), and dropped
  the temporary database afterward.
- Final full PostgreSQL suite: 47 suites / 335 tests passed, plus the
  environment test.
- TypeScript `--noEmit`, Prisma validation/status, and `git diff --check` passed
  at Batch 12-D closure.

Verification used Development and an ephemeral fresh local PostgreSQL database
only. Production was not accessed or modified.