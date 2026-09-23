# STAGE 003 — Batch 4 Product Candidates and Matching Review

Product Candidate is a review input, never a Global Product Identity. Partner candidates are tenant-owned and protected by RLS. SCO-origin candidates use the dedicated SCO Internal scope. The candidate preserves submitted values and deterministic normalized values; no AI, OCR, embeddings, external catalogs, or probability-based matching are used.

Lifecycle:

```text
SUBMITTED → NORMALIZED → MATCH_REVIEW
                         ├→ LINKED
                         ├→ NEW_PRODUCT_PROPOSED
                         ├→ CLARIFICATION_REQUIRED
                         └→ REJECTED
```

`ProductMatchAssessment` records matched, differing, and missing attributes, explanation, reviewer, and decision. Linking preserves the candidate and history. New Product proposals remain DRAFT and use the Batch 3 catalog approval boundary before ACTIVE. Rejection requires a reason; clarification preserves the unresolved history.

Matching means the same Product Identity. Similar specifications do not create substitutions; brand, manufacturer, and model remain identity-defining where applicable.

Future Partner Portal architecture must support multiple Company users, departments, projects, and user-originated needs/documents with RBAC rather than job-title authorization. Project management, Project Membership, and internal Partner approval remain deferred to the appropriate later batch; Batch 4 preserves submitter and Company ownership so those associations can be added safely.
