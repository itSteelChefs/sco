# STAGE 003 — Batch 7 Supplier Network Foundation

Batch 7 reuses `Company` and `CompanyPartnership`. Supplier Partnership, qualification, and category capability remain independent from Buyer Partnership. `PurchaseSource` is a first-class SCO_INTERNAL commercial identity for one distinct procurement channel and contains no quote, cost, discount, negotiation, or margin data.

One current `SupplierQualification` exists per Supplier Partnership. Category-specific eligibility is represented by `SupplierCategoryCapability`; a PurchaseSource inherits the supplier partnership's active category capability in this batch. Source-level category capability is intentionally deferred.

`PurchaseSourceContact` is separate because one channel may have sales, quotation, logistics, finance, management, and other contacts. Contacts are confidential and contain no credentials.

Batch 7 exposes only an SCO Internal eligibility projection from a Batch 6 Execution Item. Eligibility requires ACTIVE Supplier Partnership, ACTIVE SupplierQualification, ACTIVE SupplierCategoryCapability for the ProductCategory, and ACTIVE PurchaseSource. No final source selection, RFQ, Quote, Cost, or Negotiation is created.
