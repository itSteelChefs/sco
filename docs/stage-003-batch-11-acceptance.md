# Stage 003 Batch 11 Acceptance

Status: CLOSED / READY FOR OWNER ACCEPTANCE

Batch 11 closes the delivery and warranty foundation without introducing claims,
payment execution, inventory, Supplier Portal, or field-service workflows.

## Architecture Boundary

The implemented lineage is:

```text
Commercial Commitment Line
  -> Procurement Release Line
  -> Supplier PO Release Allocation
  -> Supplier PO Line
  -> Supplier Confirmation Event
  -> Delivery Tranche and Partner Delivery Site
  -> Physical Delivery Execution
  -> Partner Receipt
  -> Partner Acceptance or Discrepancy
  -> Warranty Entitlement
```

Delivery scheduling owns expected timing, destination, and quantity. Physical
delivery execution records what SCO delivered. Partner receipt, acceptance, and
discrepancy are separate immutable Partner facts. Warranty is a separate,
immutable entitlement attached to a supplied delivery subject.

## Owner Decisions

- `OD-11-01`: DELIVERED, RECEIVED, and ACCEPTED are separate facts.
- `OD-11-02`: SCO records DELIVERED; the Partner records RECEIVED and ACCEPTED.
- `OD-11-03`: POD and evidence are optional in the foundation.
- `OD-11-04`: Over-delivery is rejected.
- `OD-11-05`: Warranty has no universal start trigger. Every entitlement stores
  an explicit trigger, effective date, and provenance.
- `OD-11-06`: Acceptance is a fact only and does not execute payment.
- `OD-11-07`: Partial rejection remains an immutable discrepancy fact.

Warranty start triggers are DELIVERY, RECEIPT, ACCEPTANCE, INSTALLATION,
CONTRACTUAL, or PROVIDER_DEFINED. DELIVERY, RECEIPT, and ACCEPTANCE validate
their matching owned fact and date. The external triggers require an explicit
date and source reference; Batch 11 does not implement installation workflows.

## Security and Confidentiality

Batch 11 protected fact and entitlement tables use RLS and FORCE RLS. Direct
runtime table access is restricted. Purpose-built SECURITY DEFINER gateways use
the fixed `pg_catalog, public` search path, explicit actor/capability checks,
and no PUBLIC EXECUTE on sensitive gateways.

Partner reads use own-tenant safe projections only. They do not expose Supplier
POs, Purchase Sources, purchase cost, margin, negotiation, internal assignment
topology, another Partner's delivery facts, or storage keys. Supplier runtime
does not gain Partner receipt, acceptance, discrepancy, entitlement, or warranty
evidence access. Dual-role membership does not bypass these boundaries.

Warranty evidence reuses the private document/version architecture. The
Partner-safe evidence projection exposes only permitted document metadata, never
storage keys. Successful mutations are audited with actor, correlation, outcome,
and relevant fact identifiers; failed transactions do not create success audits.

## Integrity and Isolation

Scheduled quantity bounds delivery; delivery bounds receipt; receipt bounds
acceptance. Discrepancy remains independently represented. Warranty covered
quantity is positive, derived from its selected delivery/receipt/acceptance
basis, and cannot exceed the delivered quantity across entitlements for a
delivery event. Registration is idempotent and locks the authoritative delivery
event to prevent concurrent over-coverage.

Delivery execution, receipt, acceptance, discrepancy, warranty entitlement, and
warranty evidence are immutable facts. Batch 11 does not mutate Commercial
Commitment, Procurement Release, Purchase Coverage, Supplier PO commercial
facts, purchase cost, selling price, margin, or payment state.

## Intentional Exclusions

Batch 11 does not implement warranty claims, RMA, returns, replacement, refund,
service tickets, field service, installation or commissioning workflow,
maintenance contracts, warehouse/inventory, asset registry, accounting, AP,
treasury, payment execution, Supplier Portal, or future Supplier Demand.

## Legacy Reconciliation

The old supplier-commercial/payment model remains legacy Development history,
not current architecture. Batch 11 does not recreate it, clean existing legacy
objects, alter DB-only historical migration records, or restore
`commercial_version_immutable`. Current commercial documents and payment
schedules use the Supplier PO commercial-document and payment revision/item
architecture.

## Migration Baseline

- Latest migration: `0076_warranty_entitlement_foundation`.
- Filesystem migrations: 76, each with `migration.sql`.
- `0076` SHA-256:
  `99e268a835f58ae080851ee143f338453fd5beeebe6b103f56c93d2641958e62`.
- No `0077` exists.
- Historical DB-only ledger entries in Development remain documented legacy debt.

## Verification Evidence

- Focused Batch 11 closure: 15 PostgreSQL suites / 144 tests passed, plus the
  fresh-database RBAC/security gate suite with 18 tests passed.
- Full PostgreSQL suite: 45 suites / 325 tests passed.
- TypeScript `--noEmit`, Prisma validation/status, and `git diff --check` passed.
- Verification used Development and an ephemeral fresh local PostgreSQL database
  only. Production was not accessed or modified.