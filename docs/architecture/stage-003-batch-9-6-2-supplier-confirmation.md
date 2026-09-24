# Stage 003 Batch 9.6.2 — Supplier Confirmation

Supplier confirmation is an SCO-internal operational event after a Supplier PO is `ISSUED`. Confirmation uses immutable delta events; cumulative quantity and `NOT_CONFIRMED` / `PARTIALLY_CONFIRMED` / `CONFIRMED` status are derived from those events. Multiple tranches may carry different promised dates.

All confirmation tables are `SCO_INTERNAL`, protected by `FORCE RLS`, and writable only through purpose-built gateways. Recording, date changes, and reference corrections require explicit capabilities and the accepted Purchase Source × Product Category or line-responsibility scope. Lead Engineer status does not bypass these checks.

This batch records supplier facts only. It does not implement delivery execution, receipt, inventory, payments, accounting, supplier portal access, source changes, or commercial renegotiation.
