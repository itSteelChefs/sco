# STAGE 003 — Batch 6 Weekly Procurement Execution Core

Batch 6 converts approved `READY` quantities into SCO-managed execution context. A Cycle is an SCO operating container and may contain multiple Executions. A Need may be partially consumed across multiple Cycles.

READY allocation is event-oriented: `GRANTED`, `REDUCED`, `WITHDRAWN`, `CONSUMED`, `RELEASED`, and `REASSIGNED`. Assignment locks the Need in a transaction, checks ACTIVE Product Identity and ACTIVE Project (when present), verifies remaining READY quantity, and records an idempotency key. Repeated keys return the existing logical item; over-consumption is rejected.

Partner visibility is an explicit simplified projection and never exposes internal execution state, other buyers, sourcing, cost, quotes, negotiation, or margin. Cycles and executions are SCO Internal; execution items and allocation events are tenant-owned with RLS/FORCE RLS.

Late requests use a purpose-limited exception record. Unconsumed READY quantity may be withdrawn or reallocated with reason and audit; protected processing quantities require a controlled change/withdrawal request. Batch 6 does not implement sourcing, RFQ, quotes, pricing, commitment, funding, delivery, or Batch 7.
