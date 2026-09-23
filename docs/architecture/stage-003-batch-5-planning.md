# STAGE 003 — Batch 5 Rolling Planning and Demand Maturity

Batch 5 adds the minimum procurement coordination context for multi-user Partner Companies. Projects belong to exactly one Company; Project Members are separate from CompanyMembership and may have multiple descriptive CompanyDisciplines. Discipline never grants authority; RBAC remains authoritative.

`ProcurementNeed` is the single convergence model for manual and Batch 4 document-derived needs. It preserves creator, Company, optional Project, source document/line, Candidate/Product Identity, quantity, unit, need date, and maturity history. `source_document_line_id` is unique for active derived needs so retries are idempotent.

`ProcurementPlan` may contain Needs from multiple Projects within one Company, but never across Companies. A Need may appear in historical plans; the partial active participation constraint prevents ambiguous double counting.

Maturity is explicit: `FORECAST → PLANNED → APPROVED → READY`. READY requires approved Product Identity, valid quantity/unit, Need Date, Partner internal approval, `procurement_need.move_ready`, and a valid Project state when present. READY Quantity is stored independently and historically; READY is authorization to begin SCO sourcing, not a price acceptance, PO, funding, or Commercial Commitment.

Company self-approval is a configuration, OFF by default. When enabled it requires explicit permission and a complete audit record; it never bypasses maturity or creates commercial commitment.

Batch 5 excludes execution, supplier sourcing, pricing, Partner PO, funding, delivery, Projects management features, and Batch 6.
