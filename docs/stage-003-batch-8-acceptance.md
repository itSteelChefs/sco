# STAGE 003 — Batch 8 Acceptance Matrix

| Criterion | Status | Evidence |
|---|---|---|
| RFQ and RFQ item traceability | PASS | Migration 0013 foreign keys to execution, need and product identity |
| Explicit recipients and duplicate prevention | PASS | Unique RFQ/source constraint |
| Inactive-source blocking foundation | PASS | Recipient references Batch 7 source and internal eligibility boundary |
| Supplier quote and partial quote model | PASS | Quote items are optional per RFQ item |
| Immutable quote revisions | PASS | SupplierQuoteRevision with revision number/supersedes |
| Negotiation history | PASS | NegotiationSession and NegotiationEvent |
| Alternative product proposal | PASS | Separate reviewed proposal; no substitution column on RFQ item |
| Purchase cost snapshot | PASS | RFQ-item immutable snapshot model |
| Split-award quantity guard | PASS | PostgreSQL trigger locks RFQ item and rejects over-allocation |
| Currency/tax/payment/delivery preservation | PASS | Original fields and JSON terms; no FX conversion |
| SCO-only confidentiality/RLS | PASS | FORCE RLS and app.sco_internal policy on every Batch 8 table |
| Granular RBAC permissions | PASS | Seeded RFQ, quote, negotiation, source and purchase-cost permissions |
| Batch 9 exclusions | PASS | No selling price, margin, offer, PO, funding or commitment tables |

Batch 8 implementation remains subject to final integration and adversarial verification before owner approval.
