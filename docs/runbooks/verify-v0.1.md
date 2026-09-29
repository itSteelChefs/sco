# Verify V0.1 Runbook — Batch 1-A Contract

## Current status

Stage 005 Verify V0.1 Batch 1-A is an Owner-approved documentation closure. It is not implementation authorization. Batch 1-B must be separately approved.

## Product boundary

Verify V0.1 launches as confidential Quote Check for Partner-submitted quotes in HVAC & Refrigeration, Electrical, and Plumbing. Eligibility is line-level and depends on adequate identification and comparability.

Verify is advisory and does not create procurement, RFQ, PO, sourcing, negotiation, Supplier Portal, Procurement Intelligence, inventory, accounting, payment, or deployment state.

## Privacy operating rule

The default is ZERO HUMAN ACCESS to raw Partner quote content. Internal workflow roles can operate on approved metadata, workflow state, result state, and derived data without receiving raw content. `VERIFY_ANALYST` and `VERIFY_APPROVER` do not grant raw access. `VERIFY_RAW_REVIEW_ACCESS` is an independent capability but is insufficient alone: Human Review requires both explicit Partner consent and an internally authorized, purpose-specific, scope-specific, time-limited grant. Every raw-content open/access event is audited. Future security/legal exceptional access is separate policy.

The Partner projection is structurally separate from the internal result and excludes supplier identity, supplier cost, Purchase Source, negotiation history, internal commercial network references, and unauthorized evidence identifiers.

## Traceability and re-verification

Every final result must trace:

```text
VerifyRequest
  -> VerifyQuoteRevision
  -> VerifyQuoteLine
  -> VerifyRun
  -> VerifyEvidenceBinding
  -> VerifyResult
```

Partner input changes that affect comparability create a new quote revision. Evidence/reference or methodology changes create a new run on the same revision. A failed run never returns to `RUNNING`; retry creates a new run linked by `retry_of_run_id`, using the same or newer Evidence Set. Historical runs and results are never rewritten; later results supersede earlier ones.

## Partial results

- A real zero-value line counts in line coverage but contributes zero to value coverage. Pure informational/non-price lines count in neither coverage.
- Line-specific tax, discount, shipping, and adjustments stay with their line. Quote-level adjustments remain separate, are never automatically allocated, and unallocated header amounts are excluded from value coverage.
- Each submitted currency is analyzed independently; no aggregate variance/range spans currencies until FX Methodology is approved.
- Invalid lines are `NEEDS_COMPLETION` or `NOT_VERIFIABLE`. Suspected duplicates require confirmation; they are not auto-deleted or auto-merged.
- Zero verified lines or zero verified value: `INSUFFICIENT_FOR_RESULT`.
- Some verified scope with remaining unresolved/not-verifiable applicable scope: `PARTIAL`.
- `FULL` only when every applicable price-bearing line has a valid Verify result. Any applicable `NEEDS_COMPLETION` or `NOT_VERIFIABLE` line prevents it; informational lines do not.

No percentage threshold is used. Line and value coverage must always be shown, and conclusions apply only to verified scope. Confidence describes evidence quality and is separate from coverage and variance.

## Evidence contract

Evidence/reference inputs require type, internal source identity, version, effective date, capture date where applicable, freshness, approval state, comparability metadata, confidentiality class, and integrity/version reference. Every run and result binds `methodology_version`. Evidence weighting, ranking, and precedence are deferred to a future Verified Range Methodology decision.

## Finality and retention

`DRAFT` and `SUBMITTED` requests may cancel. Started runs remain historical, and authorized cancellation yields `CANCELLED`. A prepared result may be created by the system or `VERIFY_ANALYST`; only `VERIFY_APPROVER` may transition it to `FINAL`. An approver need not have raw quote access. Where one person has both capabilities, preparation and approval are separate recorded actions. There is no auto-final. A final result is operationally immutable and may only become `SUPERSEDED`; it never returns to an editable state or is cancelled to rewrite history.

**RETENTION POLICY PENDING:** no auto-delete is authorized, and this contract makes no permanent-retention claim. Future retention policy must preserve traceability.

## Implementation gate

Do not create schema, migrations, API endpoints, gateways, DTOs, UI, or feature code from this document alone. Batch 1-B requires separate approval; future policy items remain in the architecture and acceptance documents.
