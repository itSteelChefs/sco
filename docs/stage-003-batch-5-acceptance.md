# STAGE 003 — Batch 5 Acceptance Matrix

| Criterion | Status | Evidence |
|---|---|---|
| Project belongs to one Company and code is unique within Company | PASS | `projects` constraints and planning isolation test |
| ProjectMember is separate from CompanyMembership | PASS | `project_members` model |
| Multiple Project disciplines are supported | PASS | `project_member_disciplines` many-to-many table |
| Company controls configurable disciplines | PASS | `company_disciplines` with company ownership |
| ProcurementNeed converges manual/document sources | PASS | `source_type`, document/line and candidate links |
| Plan supports multiple Projects within same Company | PASS | `procurement_plan_items` company ownership |
| Cross-company plans are prohibited | PASS | company_id RLS and plan item ownership |
| Historical plans and active participation are separated | PASS | plan history model and partial unique constraint |
| Demand maturity states are explicit | PASS | `DemandMaturity` and history table |
| READY quantity is distinct and auditable | PASS | `ready_quantity` and history quantities |
| Document-line derived need is idempotent | PASS | unique source line constraint |
| Tenant/project RLS is fail-closed | PASS | RLS/FORCE RLS policies and direct tests |
| Internal approval and move-ready permissions remain separate | PASS | architecture contract and RBAC permission design |
| No execution/Batch 6 features entered | PASS | scoped migration and documentation |
| Stage 002 and Batch 1–4 regressions pass | PASS | final verification report |

Result: **READY FOR OWNER REVIEW**. Batch 6 has not started.
