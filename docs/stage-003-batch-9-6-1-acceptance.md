# Stage 003 Batch 9.6.1 Acceptance

Current implementation is covered by real PostgreSQL tests in:

- `apps/api/test/database/supplier-purchase-order-core.integration.test.ts`
- `apps/api/test/database/supplier-po-scoped-visibility.integration.test.ts`

The focused suite covers the following verified behaviors:

- central SCO Supplier PO Draft and Issued lifecycle;
- existing Release Coverage binding without a second funding pool;
- partial quantity and remaining-open calculation;
- competing Drafts without reservation;
- SAR authority limit and safe non-SAR rejection;
- multi-Partner and multi-Release aggregation;
- multi-product same-source PO;
- qualified lower-cost alternative source with immutable original source history;
- issued PO blocks unsafe Release withdrawal;
- multiple allocations against one Release line are validated as an aggregate set; valid 40+30 and 50+50 pass, while 70+70 and previously-issued 40+current 40+30 fail atomically;
- deterministic base-row locking is separate from aggregate validation, with real PostgreSQL concurrency protection;
- Strategic Overbuy authorization, isolation, remaining quantity, Draft handling, and concurrent issuance;
- scoped Engineer read with permission plus source/category assignment;
- line responsibility and Lead Engineer management authorization;
- runtime/executor direct table denial;
- existing Batch 8–9.5 PostgreSQL regressions.

Migration ledger includes `0038_supplier_purchase_order_core`, `0039_supplier_po_strategic_overbuy_issued_quantity_fix`, `0040_supplier_po_scoped_visibility_gateways`, `0041_supplier_po_intra_po_allocation_integrity_fix`, and `0042_supplier_po_release_lock_aggregation_fix`. Supplier confirmation, delivery, supplier payment execution, accounting, inventory, ranking, and Batch 10 remain out of scope.
