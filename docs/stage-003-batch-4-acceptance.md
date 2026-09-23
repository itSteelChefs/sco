# STAGE 003 — Batch 4 Acceptance Matrix

| Criterion | Status | Evidence |
|---|---|---|
| Partner candidate is tenant-owned and RLS-protected | PASS | `product_candidates.company_id`, RLS policy, isolation test |
| SCO candidate uses SCO Internal scope | PASS | internal scope policy and service |
| Candidate is distinct from Product Identity | PASS | separate tables and lifecycle |
| Candidate lifecycle is explicit | PASS | CandidateStatus and transition service |
| Normalization is deterministic and preserves submitted values | PASS | submitted/normalized fields; no AI/OCR dependencies |
| Match assessment records explanation and attribute differences | PASS | `product_match_assessments` |
| Brand/Manufacturer/Model remain identity-defining | PASS | explicit fields and test fixtures |
| Partner cannot approve/link/activate Product Identity | PASS | review endpoint uses SCO Internal guard; catalog activation remains internal |
| Rejection requires a reason | PASS | CandidateService validation |
| Clarification preserves history | PASS | history table and regression test |
| Linking preserves candidate and assessment history | PASS | foreign keys and immutable history design |
| No automatic substitution or probabilistic matching | PASS | scoped services and architecture documentation |
| Confidential sourcing data is excluded | PASS | DTO projections contain product identity only |
| Audit coverage exists for candidate/review outcomes | PASS | CandidateService AuditService events |
| Stage 002, Batch 1–3 regressions pass | PASS | final verification results |

Result: **READY FOR OWNER REVIEW**. Batch 5 has not started.
