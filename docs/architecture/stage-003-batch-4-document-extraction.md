# STAGE 003 — Batch 4 Procurement Document Extraction Foundation

Procurement documents are tenant-confidential and reuse the Stage 002 private `DocumentsService` and storage abstraction. `ProcurementDocument` records ownership, uploader, original filename/type, storage document, processing/extraction statuses, and source metadata. `ProcurementDocumentLine` preserves raw source values alongside extracted and normalized proposals.

The extraction boundary is provider-agnostic (`DocumentExtractionProvider`, `DocumentExtractionResult`, and line proposals). The included deterministic provider accepts structured lines for development and tests only. It is assistive and unverified; it cannot activate or approve Product Identity, link a candidate without SCO review, change identity-defining values silently, or perform substitution.

Implemented input: structured line payloads through the provider contract. XLSX, PDF, and semi-structured parsing are contract-ready but deferred because they would require parser/OCR dependencies or additional security review. No external provider, credentials, OCR, AI SDK, or new dependency was added.

Traceability is preserved:

```text
ProcurementDocument → ProcurementDocumentLine → ProductCandidate → ProductMatchAssessment → ProductIdentity
```

Partner documents and lines use Tenant Context and RLS/FORCE RLS. Uploader identity and Company ownership remain explicit so future Projects and Project Members can be associated without assuming one purchasing user.
