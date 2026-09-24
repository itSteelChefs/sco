# Stage 003 Batch 9.6.1 — Supplier PO Core

Batch 9.6.1 adds the SCO-internal Supplier Purchase Order core between `PROCUREMENT_RELEASED` and supplier issuance. A PO is centrally owned by SCO, targets one qualified Purchase Source, and may aggregate released demand from multiple Partners, Releases, projects, products, and categories.

`DRAFT` is preparation only. It creates no quantity reservation and no Purchase Coverage binding. `ISSUED` is the atomic purchase action. The issue gateway locks the PO, source, release lines, and existing funding allocations, then validates open quantity, Product Identity, source qualification/capability, SAR financial authority, approved purchase-cost basis, current price evidence, and every selected line before creating immutable release-line allocations, coverage bindings, and an audit event.

The original Release source and approved cost snapshot remain immutable. An actual source may differ only when it is qualified/capable, the Product Identity is exact, the quantity is still open, and current evidence proves actual cost is no higher than the approved basis. Actual cost and approved basis are retained separately.

Strategic Overbuy is represented by an explicit SCO authorization and a separate line origin. It has no Partner, Release, or Partner Purchase Coverage relationship. Only issued Strategic Overbuy quantities consume that authorization; Draft quantities never do.

All Supplier PO tables are `SCO_INTERNAL`, use FORCE RLS, and deny direct runtime/executor DML. Purpose-built SECURITY DEFINER gateways enforce RBAC and operational scope. Engineers receive only assigned source/category lines; Lead Engineer and line responsibility are coordination roles and do not grant strategic supplier or pricing authority.
