# Stage 005 — SCO Verify V0.1

## Batch 1-A — Architecture and Acceptance Contract

**Status:** Owner-approved Batch 1-A documentation closure. These state machines and policy boundaries are final for the Batch 1-B Foundation; this document is not implementation authorization.

## Product definition

Verify V0.1 is a confidential procurement-advisory product. Launch scope is **Quote Check** for Partner-submitted quotes in HVAC & Refrigeration, Electrical, and Plumbing. Eligibility is determined per line by identifiability and comparability, not by sector label alone.

Verify does not create or execute RFQs, supplier selection, negotiation, procurement orders, commitments, inventory, accounting, payments, or Procurement Intelligence records. It does not reuse the internal Supplier Quote/procurement domain as a Partner-submitted quote. Verify data has no automatic secondary use.

The default privacy posture is **ZERO HUMAN ACCESS** to raw Partner quote content. Machine processing may operate on permitted data. `VERIFY_ANALYST` and `VERIFY_APPROVER` do not grant raw-content access. `VERIFY_RAW_REVIEW_ACCESS` is an independent capability, but is insufficient by itself: raw access requires both explicit Partner consent for Human Review and an internally authorized, purpose-specific, scope-specific, time-limited grant. Every raw-content open or access event is audited with actor, purpose, scope, reason, authorization basis, and expiry. Future security/legal exceptional access is a separate policy.

## Domain contract

The preliminary Verify-specific entities are:

| Entity | Purpose and ownership | Versioning/security |
| --- | --- | --- |
| `VerifyRequest` | Partner-owned request for one Company | Tenant-scoped; mutable only before submission; request lifecycle and audit |
| `VerifyQuoteRevision` | Immutable Partner quote input revision | One request; Partner input change creates a new revision |
| `VerifyQuoteLine` | Line identity, commercial input, and readiness state | Belongs to one revision; historical line facts are immutable once used |
| `VerifyEvidenceBinding` | Binding from a run/result to evidence and reference versions | Stores provenance, integrity/version reference, approval state, dates, and confidentiality |
| `VerifyRun` | One execution against one quote revision and evidence set | Binds `methodology_version`; evidence/reference or methodology change creates a new run; retries link through `retry_of_run_id` |
| `VerifyResult` | Historical internal result and Partner projection source | Binds `methodology_version`; operationally immutable after finalization; later result supersedes rather than mutates it |

Reuse existing `Company`, membership/RBAC, Product Identity, Unit, Category, Document, DocumentVersion, and audit infrastructure where their semantics match. Supplier Quote, Purchase Source, purchase cost, negotiation, and procurement objects remain separate because they are SCO-internal commercial facts.

Canonical versioning rule:

```text
Partner Input Change       -> New VerifyQuoteRevision
Evidence/Reference Change  -> New VerifyRun on the same revision
```

## Final state machines

These finalized rules are not yet implementation authorization.

### VerifyRequest

```text
DRAFT -> SUBMITTED -> IN_REVIEW -> COMPLETED
  |          |
  +-> CANCELLED <-+
```

Submission requires a complete request envelope and an owned quote revision. `DRAFT` and `SUBMITTED` may transition to `CANCELLED` where authorized. `IN_REVIEW` completes only when finalization conditions are satisfied. There is no `COMPLETED -> DRAFT` transition. A changed input creates a new quote revision; cancellation does not rewrite history.

### VerifyQuoteRevision

```text
Partner Input Change -> new VerifyQuoteRevision
```

The historical locked revision is immutable. Evidence or reference changes alone do not create a quote revision; they create a new run on the same revision.

### VerifyQuoteLine readiness

```text
NEEDS_COMPLETION -> READY_FOR_VERIFICATION
NEEDS_COMPLETION -> NOT_VERIFIABLE
READY_FOR_VERIFICATION -> NOT_VERIFIABLE   (before a final result, with reason)
```

`READY_FOR_VERIFICATION -> NOT_VERIFIABLE` is permitted only before immutable result binding and requires a reason. Line transitions require an audit event and idempotent/concurrency-safe update. A line already included in a final result is not rewritten; a new revision/run is required. Non-price informational lines are distinct from applicable price-bearing lines.

### VerifyRun

```text
QUEUED -> RUNNING -> COMPLETED
                 \-> FAILED
QUEUED/RUNNING -> CANCELLED
```

Runs bind one quote revision, one evidence/reference set, and one `methodology_version`. A started run remains historical; an authorized cancellation yields `CANCELLED`. `FAILED` never returns to `RUNNING`: every retry creates a new `VerifyRun` linked by `retry_of_run_id`, using the same or a newer Evidence Set. An evidence/reference or methodology change also creates a new run.

### VerifyResult

```text
preparation state -> FINAL -> SUPERSEDED
```

A result may be prepared by the system or `VERIFY_ANALYST`. The `FINAL` transition requires `VERIFY_APPROVER`; an approver does not require raw quote access. Where one person has both Analyst and Approver capabilities, preparation and finalization are two separately recorded actions using the separate capabilities. No auto-finalization is approved. `FINAL` is operationally immutable, never returns to an editable state, and is not cancelled to rewrite history. A later run may create a new final result and mark the prior result `SUPERSEDED`; historical values remain unchanged.

## Partial verification

All measures are computed from the locked quote revision, independently for each submitted currency:

- `total_line_count`: applicable price-bearing lines, including real zero-value lines; pure informational/non-price lines are excluded.
- `total_quote_value`: only monetary values attributable to applicable lines.
- `eligible_line_count/value`: lines sufficiently identifiable and comparable.
- `verified_line_count/value`: eligible lines with completed verification.
- `unresolved_line_count/value`: lines needing completion.
- `not_verifiable_line_count/value`: lines explicitly not verifiable.
- `line_coverage_percent`: verified applicable lines divided by applicable lines.
- `value_coverage_percent`: verified attributable line value divided by attributable line value.

Classification has no arbitrary percentage threshold:

- `INSUFFICIENT_FOR_RESULT`: `verified_line_count == 0` or `verified_value == 0`.
- `PARTIAL`: some verified scope exists, but unresolved or not-verifiable scope remains.
- `FULL`: every applicable price-bearing line has a valid Verify result; any applicable `NEEDS_COMPLETION` or `NOT_VERIFIABLE` line prevents `FULL`. Informational/non-price lines do not prevent `FULL`.

Real zero-value lines contribute to line coverage but zero value coverage. A line-specific tax, discount, shipping, or other adjustment belongs to that line. A quote-level adjustment remains separate and is not automatically allocated; unallocated quote-level amounts are never represented as covered. Submitted currencies are preserved and no aggregate variance or range spans currencies; each currency scope is analyzed independently. Invalid lines are `NEEDS_COMPLETION` or `NOT_VERIFIABLE`. Suspected duplicates are neither auto-deleted nor auto-merged and require confirmation.

Variance and reference conclusions apply only to verified scope. Confidence is a separate evidence-quality context and never means that a Partner price is universally correct. No numeric confidence threshold, evidence ranking, weighting, or precedence is defined in Batch 1-A.

## Result contracts

The internal result may contain authorized workflow metadata, evidence provenance, methodology version, input fingerprints, verifier/system identity, timestamps, coverage, exclusions, reference range/value, variance, confidence context, and supersession links.

The Partner result is a separate DTO/projection by construction. It may contain line identity, verified scope, reference range/value, variance, confidence context, coverage, exclusions, limitations, timestamps, and result version. It must not contain Supplier Identity, Supplier Cost, Purchase Source, negotiation history, internal commercial network references, or unauthorized evidence identifiers.

## Evidence provenance

Every evidence/reference input must preserve:

- evidence classification/type;
- internal source identity;
- source/version identifier;
- effective/version date;
- capture/observation date where applicable;
- freshness;
- approval status;
- comparability metadata;
- confidentiality classification;
- integrity/version reference.

Every run and result binds `methodology_version`. A methodology change requires a new run; historical results remain unchanged. Batch 1-A does not define evidence precedence, weighting, ranking, or numeric confidence. Those belong to a future **Verified Range Methodology** decision.

## Security and privacy invariants

- Tenant ownership is derived server-side from authenticated actor, active membership, and capability; client identifiers are not authorization.
- RLS/FORCE RLS and purpose-limited gateways remain the database boundary.
- Raw Partner content is inaccessible to humans by default; `VERIFY_RAW_REVIEW_ACCESS` alone, `VERIFY_ANALYST`, and `VERIFY_APPROVER` are insufficient for raw access.
- Human review requires Partner consent plus an internally authorized, purpose-specific, scope-specific, time-limited grant, and every open/access event is audited.
- Partner projections are structurally separate from internal results.
- No Verify event automatically feeds Procurement Intelligence or procurement execution.
- Historical quote revisions, evidence bindings, runs, results, and audit records are immutable after their respective finalization points.

## Explicit exclusions

Supplier Portal, standalone Price Check, RFQ, PO, sourcing, supplier selection, negotiation, procurement execution, inventory/warehouse, accounting/AP, treasury/payment execution, AI forecasting, production deployment, and unrelated Stage 004 work are outside V0.1.

## Future policy register

- **RETENTION POLICY PENDING:** no auto-delete is approved now; do not claim permanent retention. The foundation must allow future retention policy without breaking traceability.
- **Verified Range Methodology:** weights, calculations, evidence ranking, and precedence remain out of scope. The foundation supports Evidence Provenance, Evidence Version, Evidence Date/Freshness, Approval State, and Methodology Version without hardcoded ranking or weighting.
- **FX Methodology:** mixed currencies remain independently scoped until a future methodology is approved.
- **Future exceptional security/legal raw access:** separate from the Human Review authorization rule above.
