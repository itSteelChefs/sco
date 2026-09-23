# STAGE 003 — Batch 1 Domain and Confidentiality Contracts

This document establishes the approved Stage 003 architecture vocabulary and security contracts. It contains no commercial feature implementation and creates no database migration.

## Ownership

- **SYSTEM:** identity, sessions, RBAC definitions, audit infrastructure, and system configuration.
- **PRE_TENANT:** qualification applications before approval. A pre-tenant application creates no active tenant, partnership, membership, or portal entitlement.
- **GLOBAL:** SCO-managed product catalog, category definitions, dynamic category attributes, units, currencies, and approved Product Identity.
- **TENANT:** company plans, demand maturity, procurement requests, Partner PO, customer offer/acceptance, funding state, delivery, and warranty records belonging to that company.
- **SCO_INTERNAL:** SCO-owned purchase sources, sourcing relationships, supplier quotes, purchase costs, negotiations, cross-company aggregation, buying power, and internal pricing.

SCO Internal Scope is a dedicated operational scope. It is not a fake buyer or supplier tenant.

## Relationships

`Company` is the legal entity. Buyer and Supplier are independent partnerships on the same Company. `Supplier Company` is the legal/commercial company; `Purchase Source` is the confidential channel or relationship used by SCO. A Partner is a qualified buyer relationship. Existing Stage 002 RBAC remains authoritative; job titles do not grant access.

## Confidentiality

- `PUBLIC_PRODUCT`: approved brand, manufacturer, model, technical identity, unit, and warranty identity where commercially appropriate.
- `TENANT_CONFIDENTIAL`: a buyer's plans, quantities, projects, contacts, Partner PO, funding, and commitment.
- `SCO_COMMERCIAL_CONFIDENTIAL`: purchase sources, supplier quotes, purchase cost, discounts, negotiation history, and buyer contribution to aggregation.
- `SCO_HIGHLY_RESTRICTED`: margin, full network mappings, sensitive strategy, and restricted overrides.

These classifications apply beyond UI to APIs, DTOs, exports, documents, filenames, notifications, search, audit views, logs, and reports.

## Security contracts

Tenant-owned data requires validated Tenant Context, `ENABLE/FORCE RLS`, transaction-local `app.tenant_id`, explicit runtime grants, and direct PostgreSQL isolation tests. SCO Internal processes use purpose-limited authorization and must never use a generic RLS bypass or unrestricted raw cross-tenant runtime access. Only authorized aggregate projections may leave the internal boundary.

Purchase Cost, Purchase Source, supplier quotes, negotiation history, internal pricing, margin, and buyer contribution are never exposed through Partner DTOs. Public Product Identity may remain visible where appropriate.

## API visibility

- **SCO Owner/Admin:** full access subject to explicit audit and highly restricted permissions.
- **Authorized SCO Employee:** only need-to-know internal fields.
- **Buyer Admin/User:** own tenant data and approved aggregate/offer projections only.
- **Future Supplier Admin/User:** own supplier data and approved aggregate demand projections only; no buyer identity, individual quantity, other supplier, or SCO selling price.

## Commercial boundaries

Partner PO is a first-class commercial entity. `READY → SCO_OFFER → ACCEPTED → PARTNER_PO_ISSUED → COMMITTED` is the commitment boundary; after commitment the record is commercially locked. Changes use a first-class Change/Exception Request and preserve history. Funding is a manual gate: `COMMITTED → AWAITING_PAYMENT → FUNDED → PROCUREMENT_RELEASED`.

The first implementation uses one active approval step, preserves future multi-level extensibility, prohibits self-approval by default, and requires explicit permission plus full audit for the Owner/Super Admin exception.

## Exclusions

Batch 1 does not include OCR, AI extraction, ERP integration, a full Supplier Portal, Production deployment, live financing, or a credit engine.
