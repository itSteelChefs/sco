# Stage 005 — Batch 1-A Acceptance Contract

**Scope:** documentation only. No schema, migration, application code, API, gateway, CI/CD, or deployment change is authorized.

## Acceptance criteria for later implementation

1. A Partner can create a VerifyRequest owned by its Company.
2. Cross-tenant read, write, and result access are denied.
3. The default is ZERO HUMAN ACCESS: raw Partner quote content is not human-readable by default.
4. `VERIFY_ANALYST`, `VERIFY_APPROVER`, and `VERIFY_RAW_REVIEW_ACCESS` alone cannot read raw quote content.
5. Authorized human review requires both explicit Partner consent and an internally authorized, purpose-specific, scope-specific, time-limited grant.
6. Every raw-content open/access event is audited.
7. A material Partner input change creates a new VerifyQuoteRevision.
8. An evidence/reference change creates a new VerifyRun on the same revision.
9. Historical revisions, evidence bindings, runs, and final results remain immutable.
10. Partner projection cannot expose supplier identity, source, cost, negotiation, or internal network data.
11. A partial result never represents the complete quote.
12. Line and value coverage calculations are deterministic and auditable: real zero-value lines count only in line coverage, while informational/non-price lines count in neither coverage.
13. Line-specific adjustments remain on their line; quote-level adjustments remain separate, are not automatically allocated, and unallocated header amounts are excluded from value coverage.
14. Zero verified lines or zero verified value produces `INSUFFICIENT_FOR_RESULT`.
15. `FULL` requires valid Verify results for every applicable price-bearing line; any applicable `NEEDS_COMPLETION` or `NOT_VERIFIABLE` line prevents it, while informational/non-price lines do not.
16. Some verified scope with remaining unresolved/not-verifiable applicable scope produces `PARTIAL`.
17. Submitted currencies remain isolated; no aggregate variance/range crosses currencies.
18. Invalid lines become `NEEDS_COMPLETION` or `NOT_VERIFIABLE`; suspected duplicates require confirmation and are never auto-deleted or auto-merged.
19. Evidence provenance, version, date/freshness, approval state, and methodology version are preserved for every reference input.
20. No evidence weighting, ranking, or precedence is hardcoded in Batch 1-A.
21. `DRAFT` and `SUBMITTED` requests may cancel; started runs remain historical and cancelled runs become `CANCELLED`.
22. A failed retry creates a new run with `retry_of_run_id`; a failed run never returns to `RUNNING`.
23. Only `VERIFY_APPROVER` may transition a prepared result to `FINAL`; approval does not require raw-content visibility, and no auto-final is permitted.
24. Final results are operationally immutable, may only become `SUPERSEDED`, and preserve historical traceability.
25. Methodology changes create a new run; historical results remain unchanged.
26. Verify creates no Procurement Intelligence record, ingestion event, RFQ, PO, sourcing, negotiation, or procurement side effect.
27. No generic cross-tenant bypass exists; internal and Partner result contracts are separate DTO/projection contracts.
28. Retention remains `RETENTION POLICY PENDING`; no auto-delete or permanent-retention claim is introduced.
29. Traceability is complete from Request → QuoteRevision → QuoteLine → Run → EvidenceBinding → Result.
30. Batch 1-A itself changes only documentation and creates no migration.

## Required test classes for Batch 1-B and later

- happy path full verification, including every applicable price-bearing line;
- partial quote and all-unresolved quote;
- line completion followed by re-verification;
- material quote revision after a result;
- evidence revision on the same quote revision;
- unauthorized tenant and internal access;
- zero-human-access and consent-plus-grant human-review audit;
- zero-value, informational-line, quote-level-adjustment, mixed-currency, invalid-line, and duplicate-confirmation coverage;
- cancellation/finality, retry-to-new-run, approval-without-raw-access, and methodology-version history;
- supplier/source/cost confidentiality;
- evidence and result immutability;
- audit and supersession history;
- coverage math and edge-case policy;
- no Procurement Intelligence, RFQ, PO, or procurement side effects.

## Future policy register

Only the following remain for future Owner policy:

- Retention/Legal Policy details;
- Verified Range Methodology, including weights, calculations, evidence ranking, and precedence;
- FX Methodology;
- future exceptional security/legal raw-access policy.
