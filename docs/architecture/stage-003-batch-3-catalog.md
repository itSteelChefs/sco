# STAGE 003 — Batch 3 Global Product Catalog

Batch 3 establishes the SCO-managed global catalog only. Product identity is independent from Supplier Company, Purchase Source, quotes, cost, negotiation, and aggregation.

## Ownership and write boundary

Categories, category attributes, units, currencies, and Product Identity are GLOBAL data. They are readable as approved projections, but writes require an explicit SCO Internal transaction. The existing RBAC vocabulary includes `catalog.read`, `catalog.manage`, and `catalog.approve`; the internal guard remains the enforcement boundary until feature-specific role assignment is configured.

## Category attributes

`CategoryAttributeDefinition` is dynamic and category-specific. It supports stable keys, data types, required/optional state, unit applicability, validation metadata, ordering, and active state. No HVAC, cable, or paint attributes are hard-coded and no universal specification schema is introduced.

## Brand and Manufacturer decision

Batch 3 stores `brand`, `manufacturer`, and `model_reference` as explicit Product Identity fields. Separate Brand/Manufacturer tables are intentionally deferred: no approved cross-category identity registry or lifecycle was required, and explicit fields preserve the commercial identity without coupling it to sourcing. A future registry can be introduced through a versioned migration if operations demonstrate the need.

## Lifecycle and history

Product Identity uses `DRAFT`, `ACTIVE`, and `RETIRED`. An ACTIVE identity cannot silently change category, brand, manufacturer, model, public specification, or unit; the database trigger fails closed. Versioning is retained on the identity and future identity-defining changes require a new version workflow.

SAR is inserted as the base currency. Multiple currencies and units are supported, but there is no automatic conversion or external FX integration.

Product Candidates, matching, substitution, procurement, supplier data, pricing, and all later commercial workflows are outside Batch 3.
