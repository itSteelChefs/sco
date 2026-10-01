# Stage 006 — Batch 006-D — Sensitive Document Policy

## A. Contract Status & Authority

This document is the authoritative **Sensitive Document Policy** for SCO. It defines what makes content sensitive, who may hold it, for what purpose, to whom it may be disclosed, at what identity level, what may be downloaded or exported, how derived content inherits restriction, what must be audited, and what remains dependent on a future retention decision.

Batch 006-D is **documentation / contract only**. It implements nothing: no runtime code, no schema, no migration, no database change, no API, no authorization implementation, no document-control, redaction, DLP, encryption, watermarking, download/export, retention job, or connector/integration implementation.

| Authority | Status |
| --- | --- |
| Engineering baseline `c2f2ad4a37ef06995c75f08c5fdc52de24909271` | Authoritative HEAD for all evidence in this document |
| `docs/architecture/stage-006-domain-data-ownership-matrix.md` (006-A) | CLOSED — ownership axis, not reopened |
| `docs/architecture/stage-006-purpose-taxonomy-cross-purpose-flow-contract.md` (006-B) | CLOSED — purpose axis, not reopened |
| `docs/architecture/stage-006-disclosure-identity-matrix.md` (006-C) | CLOSED — disclosure/identity axis, not reopened |
| Owner decision: Sensitive Document Controls — **Policy First, Controls Second** | Governing |
| Strategic Baseline and Strategic Baseline Addendum (incl. Procurement Systems Integration) | Governing |

**Axis position.** 006-A established *who owns it*. 006-B established *for what purpose it may be used*. 006-C established *at what identity level it may be disclosed*. 006-D establishes *how sensitive content is governed across its whole life* — and is therefore the first Stage 006 contract that spans all three axes at once for a single asset type. It introduces no new ownership, no new purpose, and no new disclosure permission. Where it appears to restate an upstream rule, it is applying it to content, not re-deciding it.

No contradiction with 006-A, 006-B or 006-C was found during construction or self-review.

## B. Governing Owner Decision — Policy First, Controls Second

This contract states the policy requirement. It does not claim the policy is enforced.

Four statuses are kept strictly separate throughout, and never merged:

| Label | Meaning |
| --- | --- |
| **POLICY REQUIREMENT** | What this contract requires, regardless of whether anything enforces it |
| **CURRENT ENFORCEMENT EVIDENCE** | What the repository demonstrably enforces today, with a citation |
| **ENFORCEMENT GAP** | The distance between the two, registered in section T |
| **FUTURE CONTROL REQUIREMENT** | What a later authorized Stage must be able to control, section U |

**NO TRUST CLAIM WITHOUT EVIDENCE.** Every `ENFORCED` claim in section S cites a migration, a source file, or a test. Where the repository does not prove enforcement, this document says so plainly, including where the absence is uncomfortable.

Evidence statuses used:

| Status | Meaning |
| --- | --- |
| `ENFORCED` | A mechanism exists and demonstrably prevents the violation |
| `PARTIALLY ENFORCED` | A mechanism exists but covers only part of the requirement |
| `NOT ENFORCED` | The capability exists in the system but nothing prevents the violation |
| `NOT IMPLEMENTED` | The capability does not exist at all, so the violation is currently impossible by absence |
| `POLICY ONLY` | This contract states the rule; nothing in the repository addresses it |

The distinction between `NOT ENFORCED` and `NOT IMPLEMENTED` is load-bearing. `NOT IMPLEMENTED` is *currently safe but structurally unguarded*: the risk appears the moment the capability is built.

## C. Scope & Definitions

### C.1 Scope

In scope: all sensitive content SCO holds, receives, derives, stores, discloses or disposes of, in any representation supported by repository evidence; the policy rules governing its lifecycle; the current enforcement inventory; the gap register; and prospective Stage 009 requirements as documentation only.

Out of scope: implementation of any control; resolution of FOG-1 … FOG-6; any change to 006-A/006-B/006-C; Workspaces; Service Access; Agent/Principal model; integration.

### C.2 Definitions

| Term | Definition in this contract |
| --- | --- |
| **Content object** | Any representation of information that can carry sensitivity — not only a file |
| **Document asset** | A stored binary object plus its registry row (`documents`, `document_versions`) |
| **Custody** | SCO physically holding the bytes. Custody is not ownership and not authority |
| **Ownership** | The authoritative organizational context, per 006-A |
| **Access** | An authorized actor being able to read the content inside a purpose |
| **Disclosure** | Another party receiving content or identity derived from it, per 006-C |
| **Derived content** | Anything produced from a content object: extraction, normalization, metadata, summary, conversion, preview, export |
| **Embedded identity** | Identity carried *inside* content or its derivatives, not in a row-level column (006-C class IC-9) |
| **Egress** | Content or derived content leaving SCO's boundary toward any external party |
| **Download** | An authorized party obtaining a retained copy of a content object |
| **Export** | Producing a new artefact containing content or derived content, in bulk or transformed form |
| **Disposal** | Irreversibly removing content and its derivatives |

**A document is an asset, not a permission.** This phrasing is carried forward from 006-B and 006-C deliberately: possessing, storing or reaching a content object confers no purpose authority and no disclosure authority.

### C.3 Actor-neutral wording

Policy statements in this contract refer to an **authorized actor** or **principal**, not to a person. Current evidence already includes a non-human principal: `public.verify_system_actor_id()` returns a fixed UUID registered as a `"User"` row, and the Verify SYSTEM gateways accept no caller-supplied actor parameter. Nothing in this policy assumes an actor is human. This is wording discipline only and designs no Agent Model.

## D. What Makes Content Sensitive

Sensitivity in SCO is **not** a property of file type. It is a function of four independent dimensions. A content object is sensitive if it scores on **any** of them.

| Dimension | Question | Grounded example |
| --- | --- | --- |
| **D1 — Ownership context** | Whose organizational context does it belong to? | `documents.company_id` binds every document to one company |
| **D2 — Purpose confinement** | Which purpose was it collected for, and does reuse require authorization? | A Verify raw quote exists only for PUR-14; it is not procurement input |
| **D3 — Identity exposure** | Does it carry identity that another party must not receive? | A BOQ may name the partner, the project, a site and a person |
| **D4 — Commercial position** | Does it reveal SCO's or a counterparty's commercial standing? | Supplier quotes, buy-side cost, margin, internal pricing logic |

**Consequences of a four-dimensional model.**

1. A content object may be sensitive for one recipient and not another — sensitivity is relational, never absolute.
2. Removing one dimension does not declassify. Aggregating away identity (D3) does not release purpose confinement (D2).
3. Low-value-looking artefacts can be highly sensitive: a filename alone may carry D3, and a quantity alone may carry D4.
4. Sensitivity attaches to **information**, so it survives transformation into derived content (section K).

**Existing evidence of classification — and its fragmentation.** SCO already has three *separate, uncoordinated* classification vocabularies:

| Vocabulary | Values | Constraint | Scope |
| --- | --- | --- | --- |
| `documents.access_scope` | `TENANT`, `SCO_INTERNAL` | `CHECK` constrained | All documents |
| `supplier_po_commercial_documents.classification` | `SCO_INTERNAL_PRIVATE`, `SCO_INTERNAL_SHAREABLE_LATER` | `CHECK` constrained | Supplier PO commercial documents only |
| `verify_evidence_bindings.confidentiality_class` | — | **`TEXT NOT NULL` with no `CHECK`** | Verify evidence only |

POLICY REQUIREMENT: a single coherent sensitivity model must eventually govern all content classes. CURRENT ENFORCEMENT EVIDENCE: three partial vocabularies, one of them unconstrained. Registered as **GAP-01**.

## E. Sensitive Content Classes

Thirteen classes, each grounded in repository evidence. "Form" uses only representations the repository actually supports; no runtime object type is invented. SCC-08 carries a **reference** to a document whose ownership stays with the document's company — tracked separately as SCC-08-REF in the policy matrix (section H).

| ID | Class | Form | Repository evidence |
| --- | --- | --- | --- |
| **SCC-01** | Base document asset | Stored object + registry row + version row | `documents`, `document_versions` (`0004`); `access_scope` (`0020`); `status ∈ {STAGED, AVAILABLE, REVOKED}`; `storage_key TEXT UNIQUE`, `sha256` |
| **SCC-02** | Partner procurement document | Registered uploaded file | `procurement_documents` (`0008`) — `company_id`, `uploader_user_id`, `document_type`, `source_metadata` |
| **SCC-03** | Extracted procurement line data | **Derived structured content** | `procurement_document_lines` (`0008`) — `raw_value JSONB`, `description`, `quantity`, `brand`, `manufacturer`, `model_reference`, `technical_specification JSONB`, `extraction_metadata JSONB`, `normalized_value JSONB` |
| **SCC-04** | Supplier quote document | SCO-internal file linked to a quote revision | `supplier_quote_documents` (`0020`) + `documents.access_scope='SCO_INTERNAL'` |
| **SCC-05** | Supplier PO commercial document | Classified commercial file | `supplier_po_commercial_documents` (`0046`) — `document_type`, `classification` |
| **SCC-06** | Commercial document coverage & verification | Derived verification record | `supplier_po_commercial_document_line_coverage`, `supplier_po_commercial_document_verifications` (`0046`) |
| **SCC-07** | Verify raw partner quote content | Referenced raw file, zero-access by default | `verify_quote_revisions.raw_content_document_id` / `raw_content_version_id` (`0082`) |
| **SCC-08** | Verify evidence **binding** (the binding record only) | Binding record + provenance attributes | `verify_evidence_bindings` (`0082`) — `confidentiality_class`, `integrity_version_reference`, `approval_state`, `source_identity`, plus **references** `document_id` / `document_version_id` |
| **SCC-09** | Destination & receiving content | Identity-bearing operational content | `partner_delivery_sites.location_details JSONB`, `receiving_contact JSONB`, `operational_label` (`0058`) |
| **SCC-10** | Procurement Intelligence lineage material | Identifiable lineage | `buying_power_snapshot_source_memberships` (`0061`) |
| **SCC-11** | Audit & security evidence | Evidentiary record | `audit_logs` (`0004`); `verify_raw_content_access_events` (`0082`) |
| **SCC-12** | Storage object & storage key | Physical artefact and its locator | `documents.storage_key UNIQUE`, `document_versions.storage_key UNIQUE`; `StorageProvider` |
| **SCC-13** | Document metadata | Filename, MIME type, size, hash, timestamps, uploader | Columns on `documents` / `procurement_documents` |

Two classes deserve emphasis because they are the most commonly underestimated:

- **SCC-03** is the clearest case of sensitivity surviving transformation. A BOQ's confidentiality does not end when it becomes rows; `description`, `brand`, `model_reference` and `technical_specification` can carry the same partner-confidential and identity-bearing content as the source file.
- **SCC-12** is sensitive independently of the bytes. A storage key is a direct locator; disclosing it is a disclosure event even if the object is never fetched.

## F. Policy Principles

1. **Custody is not authority.** SCO holding content creates no purpose right and no disclosure right.
2. **Sensitivity is relational.** The same object is REAL to its owner and may be HIDDEN to a counterparty (006-C principle G.8).
3. **Sensitivity survives transformation.** Derived content inherits ownership, purpose confinement, confidentiality and disclosure restriction from its source.
4. **Access ≠ disclosure ≠ download ≠ export.** These are four distinct authorizations and must never be inferred from one another.
5. **Need-to-know and minimization.** The least content, the fewest attributes, the latest moment.
6. **Purpose boundary governs content.** 006-B Default Deny applies to content exactly as to data; a document must never become an implicit cross-purpose bridge.
7. **Identity inside content obeys 006-C.** Embedded identity is governed by REAL / MINIMIZED / ALIAS / HIDDEN regardless of where it sits.
8. **Channel neutrality.** Sensitivity is a property of the content and its context, never of how it arrived.
9. **Evidence obligation.** Content and derived content carry lineage and audit obligations; transformation does not discharge them.
10. **Disposal is a decision, not a default.** Nothing is deleted implicitly; nothing is retained forever by assumption.
11. **Exceptional access is an event.** Any access outside the ordinary posture is bounded, purposeful, authorized, minimized and audited.
12. **Actor-neutral.** All of the above apply to any authorized principal, human or not.

## G. Lifecycle Policy

Policy requirements per lifecycle phase. Enforcement reality is in section S; gaps in section T.

### G.1 Upload & registration
Content enters bound to exactly one owning company context and one declared purpose. Integrity must be recorded at registration. Content must never be written to a location derived from untrusted input.

CURRENT ENFORCEMENT EVIDENCE: `DocumentsService.stage` composes the key server-side as `${companyId}/${randomUUID()}` and never from the filename; `sha256` and `byteSize` are computed at write; the development provider writes with flag `wx` (fail if exists) and rejects traversal outside its root; the S3 provider rejects keys that are empty, absolute, or contain `.`/`..` segments. — `ENFORCED`.

### G.2 Storage
Stored objects are private by default. The storage locator is never a disclosure surface.

CURRENT ENFORCEMENT EVIDENCE: `createDocumentStorageProvider` refuses `local` storage outside `development`/`test` and otherwise requires explicit S3 configuration; **application code creates no public URL, no presigned URL and no public-read object**. — `PARTIALLY ENFORCED`.

**Evidence limit, stated explicitly.** The actual bucket policy, object ACL and deployment posture live in infrastructure configuration, **not in this repository**. Repository evidence can therefore establish only that the *application* does not create public delivery; it cannot establish a full guarantee against public storage exposure. Claiming `ENFORCED` here would be a trust claim without evidence. Registered as **GAP-11**.

### G.3 Access
Access requires ownership context or an explicitly authorized internal purpose; it never follows from custody.

CURRENT ENFORCEMENT EVIDENCE: `documents` and `document_versions` carry `ENABLE`/`FORCE ROW LEVEL SECURITY`; the `document_tenant` policy requires `access_scope='TENANT' AND company_id = app.tenant_id`, so an internally-scoped document is unreachable through the tenant path even though its row carries that company's `company_id`. Internal access to a supplier quote document runs through `get_supplier_quote_document`, a SECURITY DEFINER function requiring ACTIVE membership in an ACTIVE `type='SCO'` company holding `quote.document.read`, with `REVOKE ALL … FROM PUBLIC` and EXECUTE granted only to `sco_internal_executor`. — `ENFORCED`.

### G.4 Transformation & extraction
Derived content inherits every restriction of its source. Extraction is itself a purpose-bound operation.

CURRENT ENFORCEMENT EVIDENCE: `procurement_document_lines` carries `company_id` with a tenant RLS policy, so derived rows remain tenant-confined, and extraction emits `procurement_document.extraction_completed` / `_failed` audit actions. However **nothing propagates the source's `access_scope`, classification or purpose into the derived rows** — inheritance is structural coincidence (both are tenant-scoped), not an implemented rule. — `PARTIALLY ENFORCED`. See **GAP-04**.

### G.5 Disclosure
Disclosure of content or identity derived from content is governed by 006-C and is denied by default across party boundaries.

CURRENT ENFORCEMENT EVIDENCE: no **HTTP or production delivery path** exposes document content or its storage locator to any caller; `SupplierQuoteDocumentService` returns only filename, MIME type and size, and its test asserts the content response has no `storageKey`, no `absolutePath` and no `url`. — `PARTIALLY ENFORCED`.

**Precision required by evidence.** A **general** non-disclosure guarantee for `storage_key` is **not** enforced: `DocumentsService.authorizeDownload` validates tenant ownership and then returns `StorageProvider.authorizeDownload(storage_key)`, whose shape is `{ storageKey }`. That method is a dormant internal API — no HTTP route or production caller invokes it — but it is capable of returning the locator to an in-process caller. The correct statement is therefore *no current delivery path exposes the locator*, not *the locator is never returned*. Registered as **GAP-12**.

### G.6 Download & export
See section J. Download and export are distinct authorizations and neither follows from access.

### G.7 Retention & disposal
See section P. No retention schedule is decided by this contract.

### G.8 Audit
See section O.

## H. Sensitive Document Policy Matrix

Policy contract, not a permission table. "Default posture" is the posture absent an explicit authorization; "Identity" is the 006-C treatment of identity carried by or inside the class.

| Class | Owner / custodian | Primary purpose | Allowed recipient/context | Default posture | Identity | Download | Export | Derived content | Audit expectation | Retention | Current enforcement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **SCC-01** Base document asset | Owning company / SCO custody | Purpose of the owning workflow | Owning tenant, or an authorized internal purpose | Private; `access_scope` decides which path may reach it | Per 006-C by recipient | Owner only, with authorization | Denied by default | Inherits | Access, status change | FOG-6 | `ENFORCED` (RLS + scope) |
| **SCC-02** Partner procurement document | Partner company | PUR-05 intake | Owning partner tenant; SCO operator for processing | Tenant-confined | REAL to owner | Owner only | Denied by default | SCC-03 inherits | Upload, extraction outcome | FOG-6 | `ENFORCED` (RLS); route lacks permission decorator |
| **SCC-03** Extracted line data | Partner company (derived) | PUR-05 only | Owning partner tenant; SCO operator for processing | Tenant-confined; **not** a declassified form of the source | Embedded identity governed by 006-C | Owner only | Denied by default | Further derivation inherits | Creation and reuse | FOG-6 | `PARTIALLY ENFORCED` — tenant RLS yes, inheritance no |
| **SCC-04** Supplier quote document | SCO internal | PUR-07 buy-side | SCO operator holding `quote.document.read` | SCO-internal; unreachable by any tenant | Supplier identity HIDDEN from partner | Authorized internal purpose only | Denied by default | Inherits SCO-internal posture | Internal access | FOG-6 | `ENFORCED` (scope + definer gateway + tests) |
| **SCC-05** Supplier PO commercial document | SCO internal | PUR-12/PUR-13 | SCO operator per capability | `SCO_INTERNAL_PRIVATE` unless explicitly `SCO_INTERNAL_SHAREABLE_LATER` | Supplier identity HIDDEN from partner | Authorized internal purpose only | Denied by default | Verification records inherit | Registration, verification | FOG-6 | `ENFORCED` (immutability + classification column) |
| **SCC-06** Coverage & verification records | SCO internal | PUR-12 | SCO operator | Internal | n/a | Internal only | Denied by default | Inherits | Verification outcome | FOG-6 | `ENFORCED` (immutability trigger) |
| **SCC-07** Verify raw partner quote | Partner company | **PUR-14 only** | Nobody by default — zero human access | Owner-REAL; otherwise HIDDEN | Partner identity confined to Verify | **Denied** — no mechanism exists | **Denied** | Any derivative stays in PUR-14 | Authorization intent audited; actual opens not captured (GAP-13) | FOG-6 | `ENFORCED` by consent + grant + absence of delivery path |
| **SCC-08** Verify evidence **binding** | SCO internal (Verify) — **binding record only** | PUR-14 only | Verify actors | Internal to Verify | Evidence identifiers never partner-disclosed | Denied | Denied | Inherits | Binding creation | FOG-6 | `ENFORCED` (immutable; same-company trigger); `confidentiality_class` unconstrained |
| **SCC-08-REF** Document referenced by a binding | **Owning company of the document** (006-A), as SCC-01 | Its own purpose, plus Verify reference | Per SCC-01 | Per SCC-01 | Per 006-C by recipient | Per SCC-01 | Denied by default | Per SCC-01 | Per SCC-01 | FOG-6 | `ENFORCED` (same-company trigger prevents cross-company binding) |
| **SCC-09** Destination & receiving content | Partner company | PUR-13 | Owner REAL; supplier ALIAS with state-gated reveal | Alias by default | `DL-2R` per 006-C | Owner only | Denied by default | Inherits | Alias creation; reveal **not** audited | FOG-6 | `ENFORCED` for alias/gate; reveal audit missing |
| **SCC-10** PI lineage material | SCO internal | PUR-17 internal only | SCO operator | Internal; never disclosed | Identifiable — stays internal | Denied | Denied | Aggregate output is non-identifying | Aggregation run | FOG-6 | `PARTIALLY ENFORCED` (internal gateways only) |
| **SCC-11** Audit & security evidence | SCO (governance) | PUR-16 only | Security/accountability function | Not a commercial dataset | Attribution, not disclosure | Denied for commercial use | Denied | n/a | Is the audit | FOG-6 | `PARTIALLY ENFORCED` (append-only by grant, not trigger) |
| **SCC-12** Storage object & key | SCO custody | Serving an authorized access | No party receives the key | Never disclosed to any party | n/a | n/a | n/a | n/a | Any key exposure is an incident | FOG-6 | `PARTIALLY ENFORCED` — no delivery path exposes it (asserted by test), but a dormant internal API can return it in-process (GAP-12); storage posture itself is outside repository evidence (GAP-11) |
| **SCC-13** Document metadata | Follows its document | Follows its document | Follows its document | MINIMIZED — filename, MIME, size only | Filename may carry embedded identity | n/a | Denied by default | n/a | Metadata read where sensitive | FOG-6 | `PARTIALLY ENFORCED` — minimized response, but filename never screened |

Deliberate imprecision: the matrix does not enumerate permissions per role. Doing so would convert a policy contract into an implementation specification, which Stage 006 does not authorize.

## I. Document & Embedded Identity Rules

006-C remains authoritative for identity. This section applies it to content.

**POLICY REQUIREMENT.** Permission to access a content object is **not** permission to disclose the identities embedded inside it. A content object must not bypass disclosure policy because identity is carried in any of the following representations, each of which is a real representation in this repository:

| Representation | Evidence it can carry identity |
| --- | --- |
| Filename | `documents.filename`, `procurement_documents.filename` are free text supplied at upload |
| Document body | Arbitrary binary behind `storage_key` |
| Drawing title block | A sub-case of body content; no mechanism inspects it |
| Metadata | `source_metadata JSONB` on `procurement_documents` is unconstrained |
| Extracted text / structured extraction | `raw_value`, `description`, `technical_specification`, `normalized_value` on `procurement_document_lines` |
| Operational content | `location_details JSONB`, `receiving_contact JSONB` on `partner_delivery_sites` |
| Evidence attributes | `source_identity`, `integrity_version_reference` on `verify_evidence_bindings` |

**CURRENT ENFORCEMENT EVIDENCE.** Row-level controls operate on `company_id`, `access_scope` and capability. **No mechanism inspects, classifies or redacts content.** The honest consequence: a content object can be lawfully reachable while carrying identity that this contract forbids disclosing. — `NOT IMPLEMENTED` for embedded-identity control. Registered as **GAP-03**.

**What is enforced, and is genuinely strong.** Where SCO constructs a *projection* rather than passing content through, embedded identity is excluded by construction: the supplier delivery projection returns `destination_alias` and never the partner, the project or the site's real label, with `location_details` and `receiving_contact` `NULL` until `READY_FOR_DELIVERY`. The lesson that follows is a policy rule, not an implementation choice:

> **Projection beats redaction.** Where SCO builds the outbound artefact field-by-field, embedded identity never enters it. Where SCO forwards a counterparty-authored artefact, nothing today prevents embedded identity from travelling with it.

## J. Download & Export Policy

**POLICY REQUIREMENT.** Four authorizations are distinct and none implies another:

```
ACCESS  →  DOWNLOAD  →  EXPORT  →  EXTERNAL DISCLOSURE
```

- Viewing authorization does not grant download.
- Download authorization does not grant export.
- Access to one object does not grant bulk export.
- Internal access never grants external disclosure.
- Export of derived content is export (section K).

**CURRENT ENFORCEMENT EVIDENCE — stated precisely because this is the most important honest finding in 006-D.**

| Finding | Status |
| --- | --- |
| No HTTP route anywhere exposes document content, a download, an export, an attachment, a stream or a redirect to storage | `NOT IMPLEMENTED` |
| `readPrivate` has **one production call site** — `SupplierQuoteDocumentService.content()` — and that service is exposed by no controller; `DocumentsModule` registers only `ProcurementDocumentsController`. A test also calls `readPrivate` directly | `NOT IMPLEMENTED` as a delivery path |
| `DocumentsService.authorizeDownload` has **no production call site** — no controller or service invokes it. It is exercised only by a security test, which proves it denies a Company A document to a Company B context | Path unreachable in production, but **tenant denial is proven** |
| `StorageProvider.authorizeDownload` performs **no authorization**. Both implementations only validate and normalize the key, then return `{ storageKey }` | **Misleading name — `NOT ENFORCED`** |
| No signed URL, pre-signed URL, token, expiry or time-bounded delivery mechanism exists | `NOT IMPLEMENTED` |
| No bulk export, archive, report-export or batch-download path exists | `NOT IMPLEMENTED` |
| **No current HTTP or production delivery path exposes `storage_key`.** `SupplierQuoteDocumentService` does not expose it, asserted by test. However `DocumentsService.authorizeDownload` is a dormant internal API that **can return `{ storageKey }`** to an in-process caller after tenant validation | **A general non-disclosure guarantee is `NOT ENFORCED`**; the current delivery surface is clean |

**Policy consequence.** Today there is no document egress path, so no download or export policy is being violated. This safety is produced by **absence, not by control**. The `authorizeDownload` naming is specifically called out because a future implementer could reasonably assume it performs an authorization check. It does not. Registered as **GAP-02** and **GAP-07**.

## K. Derived & Extracted Content Policy

**POLICY REQUIREMENT.** Transformation does not declassify. A derivative inherits, without exception:

| Inherited property | Meaning |
| --- | --- |
| Ownership | The owning company of the source (006-A) |
| Purpose confinement | The purpose the source was collected for (006-B) |
| Confidentiality | The sensitivity dimensions of section D |
| Disclosure restriction | The recipient-specific level from 006-C |
| Lineage / evidence obligation | The derivative remains traceable to its source |

This applies to every transformation the repository supports or could plausibly support: text extraction, BOQ extraction, metadata extraction, normalization, conversion, preview, thumbnail, summary, structured data and export packaging.

**Derived content may be *less* disclosable than its source, never more.** Aggregation is a mitigation, not a release — carried forward unchanged from 006-B.

**CURRENT ENFORCEMENT EVIDENCE.**

- `procurement_document_lines` is the only implemented derivation. It carries `company_id` with a tenant RLS policy, so it is tenant-confined, and it preserves lineage through `document_id`. — `PARTIALLY ENFORCED`.
- The confinement is **structural coincidence**, not inheritance: nothing copies `access_scope`, classification or purpose from the source document into the derived rows, and nothing would prevent a future derivation of an `SCO_INTERNAL` document into a tenant-visible table. — `NOT ENFORCED` for inheritance. **GAP-04**.
- No preview, thumbnail, conversion, rendering, summarization, redaction or watermarking exists anywhere in the repository. — `NOT IMPLEMENTED`.
- `document_versions` is never written by production code at this baseline; only tests insert rows. Versioning exists as a structure, not as an exercised lifecycle. — recorded for accuracy.

## L. Cross-Party Content Boundaries

Applying 006-C to content. No boundary here is new; each is the content-level application of an existing closed decision.

### L.1 Partner → SCO
Partner-authored content enters SCO under the partner's ownership, confined to the purpose it was submitted for. SCO custody creates no reuse right. Content submitted for Verify (SCC-07) does not become procurement input; content submitted for procurement (SCC-02/SCC-03) does not become Verify input.

### L.2 SCO → Partner
A partner receives its own content REAL, and SCO-authored artefacts MINIMIZED. SCO → Partner disclosure must not expose supplier identity, supply source, supplier quotation, buy-side cost, buy-side negotiation, internal margin, internal pricing logic, or sourcing rationale — in a document, in its metadata, in extracted data, or in any derivative.

CURRENT ENFORCEMENT EVIDENCE: the supplier-quote document path is `SCO_INTERNAL`-scoped and gated by `quote.document.read`; the partner offer projection is allowlisted and asserted not to match `/pricing|purchase|supplier|source|margin|overhead|contribution|approvalReason/i`; fifteen buy-side and supply-network tables deny runtime reads under every spoof combination with SQLSTATE `42501`, with identical denial for known and random identifiers so existence is not disclosed. — `ENFORCED`.

### L.3 SCO → Supplier
A supplier receives the minimum required to fulfil: product, quantity, date, status and an aliased destination, with address and receiving contact revealed only at `READY_FOR_DELIVERY`. A supplier must not receive partner identity, project identity, BOQ or drawings, partner commercial intent, or unnecessary location/context — in any representation.

CURRENT ENFORCEMENT EVIDENCE: the supplier delivery projection is field-built and alias-based; the alias is random-UUID-derived, `NOT NULL UNIQUE`, and asserted not to contain the partner identifier; delivery tables reject direct runtime and executor reads. **Qualification carried forward from 006-C:** no supplier access context exists, so this path is latent and gated by FOG-5. **No document-bearing supplier disclosure path exists at all** — `NOT IMPLEMENTED`.

### L.4 Supplier → SCO
Supplier-authored commercial material (SCC-04, SCC-05) is SCO-internal by default. `SCO_INTERNAL_PRIVATE` is the default classification and `SCO_INTERNAL_SHAREABLE_LATER` is an explicit, deliberate exception — it is **not** an authorization to share, only a marker that sharing may later be considered under this policy and 006-C.

### L.5 Partner A → Partner B
HIDDEN at every class and every representation. CURRENT ENFORCEMENT EVIDENCE: tenant RLS with `FORCE ROW LEVEL SECURITY`, a `NOBYPASSRLS` non-owning runtime role, and tests proving cross-tenant denial including spoofed settings. — `ENFORCED`.

## M. Verify Evidence Boundary

Verify remains purpose-separated. 006-D adds no exception and narrows nothing.

1. **Raw partner quote content (SCC-07)** is zero-access by default. Access requires partner consent **and** an internally authorized grant recording purpose, scope, reason and authorization basis, time-bounded by `starts_at`/`expires_at`, revocable, with `CHECK (authorized_by <> actor_user_id)` so the authorizer cannot be the accessor and `CHECK (expires_at > starts_at)`.
2. **Raw-review authorization intent is audited**: `internal_verify_raw_review_authorization_check` writes `verify.raw_review.authorization_intent_recorded` to `audit_logs` with `contentDeliveryEnabled` set to `false`. The `verify_raw_content_access_events` table exists and is immutable **if populated**, protected by `prevent_verify_immutable_mutation` — but **no production path inserts into it**, because no raw-content delivery or open path is implemented. The accurate statement is therefore: *authorization intent is audited; actual raw-content opens are not captured because they cannot yet occur.* Registered as **GAP-13**.
3. **Document binding is company-confined by trigger**: `verify_quote_revision_document_valid` and `verify_evidence_document_valid` reject any document or version not belonging to the owning request's company.
4. **Evidence bindings are immutable** and carry provenance attributes including `confidentiality_class` and `integrity_version_reference`.

**Ownership vs Verify custody — required distinction (SCC-08 / SCC-08-REF).** A Verify evidence binding and the document it points at are **two different assets with two different owners**:

| Asset | Owner | Governed by |
| --- | --- | --- |
| `verify_evidence_bindings` row — the binding record, its provenance attributes and its processing context | **SCO-internal (Verify)** | SCC-08, PUR-14 |
| The document and version referenced by `document_id` / `document_version_id` | **The company that owns the document** (006-A) | SCC-01 / SCC-08-REF, and the owning workflow's purpose |

Verify holds a **reference and a processing context**, not ownership of the referenced content. Binding a document into Verify does **not** transfer ownership, does **not** place the document under PUR-14 for its owner, and does **not** extend Verify's confidentiality class over the document itself. The same-company trigger `verify_evidence_document_valid` enforces that a binding can only reference a document owned by the same company as the owning Verify request, so a binding can never acquire a reference across an ownership boundary.
5. **The Verify gateway is asserted not to reference** `storage_key`, raw-content access or raw-quote-content opening.
6. **Possession of Verify evidence does not authorize secondary commercial use.** Any future exception remains subject to **FOG-4** and separate Owner approval. This contract does not create one.

Recorded accurately: `confidentiality_class` is `TEXT NOT NULL` with **no `CHECK` constraint**, so its vocabulary is unconstrained — part of **GAP-01**.

## N. Procurement Intelligence Boundary

**Possession of a document does not make its contents authorized PI input.** Four tiers must stay distinct:

| Tier | Example | Posture |
| --- | --- | --- |
| Raw identifiable source material | SCC-02, SCC-03, SCC-07 | Never PI input without an Owner decision |
| SCO transaction data | Commitments, releases, POs | Operational; PI eligibility is a separate question |
| Derived data | Extracted lines, verification records | Inherits the source's restriction |
| Aggregated non-identifying output | `buying_power_snapshot_lines` | Non-identifying **by construction** — keyed by `(snapshot_id, product_identity_id, unit_id)` with no `company_id` and no `project_id` |

Identifiable lineage (SCC-10) remains internal. Verify material is excluded from PI by default. Audit evidence is excluded. **FOG-1 and FOG-2 remain open and are not resolved by this contract.**

## O. Audit Policy

**POLICY REQUIREMENT.** These event categories should be auditable, and must be distinguishable from one another rather than collapsed into a single "access" notion:

| Category | Why it must be distinct |
| --- | --- |
| Ordinary access | Baseline accountability |
| Download | A retained copy now exists outside SCO's control surface |
| Export | A new artefact exists, possibly in bulk or transformed form |
| Share / disclosure | Another party received content or identity |
| Reveal | A controlled transition toward real identity occurred |
| Transformation / extraction | A derivative now exists and inherits obligations |
| Administrative / security action | Classification, status, revocation or disposal changed |
| Denied attempt | Evidence of an attempted boundary violation |

Future integration/provenance events — external source, external reference, ingestion time — are a **separate** category and must not be conflated with the above. This mirrors the 006-C finding that provenance is not yet a defined dimension.

**CURRENT ENFORCEMENT EVIDENCE.**

| Event | State |
| --- | --- |
| Document upload / registration | `ENFORCED` — `procurement_document.uploaded` |
| Extraction outcome | `ENFORCED` — `procurement_document.extraction_completed` / `_failed` |
| Verify raw-review authorization intent | `ENFORCED` — `verify.raw_review.authorization_intent_recorded` with `contentDeliveryEnabled=false` |
| Verify raw-content open (actual) | `NOT IMPLEMENTED` — table exists and is immutable if populated, but no production writer and no delivery path exist |
| Alias creation | `ENFORCED` — `partner_delivery_site.created` records the alias |
| Ordinary document access | `NOT ENFORCED` — internal document reads emit no audit event |
| Download / export | `NOT IMPLEMENTED` — no such operation exists |
| Share / disclosure | `NOT ENFORCED` — projections emit no audit event |
| Reveal (state-gated destination) | `NOT ENFORCED` — read-path projection emits no event |
| Denied attempt | `NOT ENFORCED` — denials surface as SQL permission errors, not audit events |
| Purpose of access | `NOT IMPLEMENTED` — audit records the action, not the purpose |

Audit metadata is protected: keys matching `password|token|secret|credential|authorization|cookie` are stripped before insert. Structural limitation carried forward without reopening 006-B: `audit_logs` is append-only by grant and convention, not by a mutation-rejecting trigger.

**Audit evidence is governance evidence, not a commercial dataset.** Commercial reuse remains denied by default.

## P. Retention & Disposal Boundary

**FOG-6 remains open. This contract invents no retention schedule and no duration.**

### P.1 Decidable now — and hereby decided

1. Disposal is never implicit. Nothing is deleted as a side effect of another operation.
2. Disposal must consider **derivatives and lineage**, not only the source object. Disposing of a document while its extracted lines persist is not disposal.
3. Disposal must not destroy evidence that a commercial transaction occurred, nor rewrite historical commercial facts.
4. Retention duration is a function of **purpose and obligation**, not of storage convenience.
5. Immutable history remains immutable: disposal policy must not be used to circumvent Verify history immutability or commercial-document immutability.
6. Audit evidence of disposal is itself required.

### P.2 Dependent on FOG-6

Concrete durations per content class; the legal/contractual basis for each; whether disposal is deletion, anonymization or tombstoning; whether derivatives may outlive their source in aggregate form; and the disposal obligations that a terminated partner relationship triggers.

### P.3 Current evidence

| Finding | Status |
| --- | --- |
| `DocumentStatus` includes `REVOKED` | A disposal/withdrawal primitive **exists in the enum** |
| `REVOKED` is **never set** anywhere in migrations or application code | `NOT IMPLEMENTED` |
| No `DELETE` path exists for `documents` or `document_versions` in migrations or application code | `NOT IMPLEMENTED` |
| No retention job, scheduler, TTL or expiry mechanism exists | `NOT IMPLEMENTED` |
| Verify history, commercial documents and payment schedules are immutable by trigger | `ENFORCED` |

Honest summary: SCO currently retains everything indefinitely by default, because no disposal mechanism is wired. This is a known state, not a policy choice, and it is the practical reason FOG-6 matters.

## Q. Exceptional Access & Reveal

**POLICY REQUIREMENT.** Any access outside the ordinary posture is an **event**, requiring all six elements — the same discipline 006-C established for reveal:

```
OPERATIONAL NECESSITY → PURPOSE → AUTHORIZATION BASIS →
MINIMUM CONTENT → RECIPIENT/CONTEXT → SCOPE/DURATION + AUDIT
```

Additional requirements specific to content: separation of duties where the content is highly sensitive; the narrowest content scope rather than the whole object where the distinction is meaningful; and no standing exceptional access — every exception is bounded.

**CURRENT ENFORCEMENT EVIDENCE.** Exactly one exceptional-access mechanism is implemented, and it is well-formed: the Verify raw-review grant (section M) satisfies all six elements including separation of duties and immutable audit. One state-gated reveal exists for destination content. **No general exceptional-access mechanism exists** for any other content class. — `PARTIALLY ENFORCED`. **GAP-08**.

## R. Strategic Integration Compatibility

The Procurement Systems Integration Addendum is STRATEGICALLY APPROVED with **NO implementation authority**. This contract is written to be compatible with it without designing it.

**POLICY REQUIREMENT — channel neutrality.** A content object receives its sensitivity from section D, never from how it arrived. Content ingested through a Portal, API, Connector, Automation or External System is governed by exactly the same rules as content uploaded directly. Specifically:

1. **Integration Access ≠ Data Ownership.** Technical ability to read a partner system confers no ownership of its content.
2. **Integration Access ≠ Intelligence Permission.** Ingested content does not become PI input (section N).
3. **Integration Access ≠ Unlimited Processing Purpose.** Ingested content remains purpose-confined under 006-B.
4. **Ingestion is not a document-policy bypass.** Every rule in sections I, J, K and L applies unchanged to ingested content and its derivatives.
5. **Minimization applies at ingestion.** Ability to read an entire external system does not authorize ingesting it.
6. **Integration failure is not procurement failure**, and is equally not a reason to relax content policy.

**Prospective constraint only, no design.** Future external ingestion will need provenance to be distinguishable from identity, attribution and disclosure. 006-C already recorded provenance as a future gap outside its scope; 006-D records the same for content without designing it.

**No channel coupling in this contract.** Every rule above is keyed on content class, purpose, recipient and context — never on a transport, route, portal or interface.

## S. Current Enforcement Matrix

Consolidated. Every `ENFORCED` row cites evidence.

| # | Policy requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Content is bound to one owning company at registration | `ENFORCED` | `documents.company_id NOT NULL`; `DocumentsService.stage` writes `context.companyId` |
| 2 | Storage keys are server-derived, never from untrusted input | `ENFORCED` | Key composed as `${companyId}/${randomUUID()}` |
| 3 | Path traversal into storage is prevented | `ENFORCED` | Development provider resolves and rejects outside root, writes with `wx`; S3 provider rejects empty/absolute/`.`/`..` segments |
| 4 | Integrity is recorded at registration | `ENFORCED` | `sha256` computed at write in both providers |
| 5 | Public storage exposure is prevented | `PARTIALLY ENFORCED` | Application creates no public or presigned URL; `local` storage refused outside development/test. **Bucket policy/ACL is infrastructure, outside repository evidence** |
| 6 | Tenant content is isolated | `ENFORCED` | `FORCE ROW LEVEL SECURITY` + `document_tenant` requiring `access_scope='TENANT' AND company_id = app.tenant_id` |
| 7 | SCO-internal content is unreachable from the tenant path | `ENFORCED` | Same policy excludes `access_scope='SCO_INTERNAL'`; test asserts RLS hides it from runtime **and** spoofed internal settings |
| 8 | Internal document access requires explicit capability | `ENFORCED` | `get_supplier_quote_document` requires SCO membership + `quote.document.read`; `REVOKE ALL … FROM PUBLIC`; EXECUTE only to `sco_internal_executor` |
| 9 | Document existence is not disclosed to unauthorized actors | `ENFORCED` | Test asserts identical `FORBIDDEN` for a real and a random document id — no existence oracle |
| 10 | A document of one company is not authorized for another company's context | `ENFORCED` | `security-gate.integration.test.ts` — "does not authorize a Company A document for Company B" rejects with `FORBIDDEN` |
| 11 | Storage keys are not exposed by any delivery path | `PARTIALLY ENFORCED` | Test asserts the supplier-quote response has no `storageKey`, `absolutePath` or `url`; **but `DocumentsService.authorizeDownload` can return `{ storageKey }` to an in-process caller** |
| 12 | Commercial documents are immutable | `ENFORCED` | `prevent_supplier_po_commercial_document_mutation`; `prevent_supplier_po_document_verification_mutation` |
| 13 | Verify raw access requires consent + bounded grant + SoD | `ENFORCED` | Grant constraints; `authorized_by <> actor_user_id`; `expires_at > starts_at` |
| 14 | Verify raw-review authorization intent is audited | `ENFORCED` | `verify.raw_review.authorization_intent_recorded` written by `internal_verify_raw_review_authorization_check` |
| 15 | Verify raw-content opens are captured | `NOT IMPLEMENTED` | `verify_raw_content_access_events` is immutable if populated, but has **no production writer**; no raw-content delivery path exists |
| 16 | Verify documents are company-confined | `ENFORCED` | `verify_quote_revision_document_valid`, `verify_evidence_document_valid` |
| 17 | Supplier-facing projections exclude partner/project identity | `ENFORCED` | Alias-based projection; alias asserted not to contain the partner identifier |
| 18 | Buy-side commercial material is unreachable from tenant context | `ENFORCED` | Fifteen tables denied under all spoof combinations, SQLSTATE `42501` |
| 19 | Derived content remains tenant-confined | `PARTIALLY ENFORCED` | `procurement_document_lines.company_id` + tenant policy |
| 20 | Derived content inherits source classification/purpose | `NOT ENFORCED` | Nothing propagates `access_scope`, classification or purpose |
| 21 | Document metadata is minimized on response | `PARTIALLY ENFORCED` | Metadata returns filename, MIME, size only; filename content never screened |
| 22 | Embedded identity is controlled | `NOT IMPLEMENTED` | No mechanism inspects, classifies or redacts content |
| 23 | Download is distinct from access | `NOT IMPLEMENTED` | No download route exists; `StorageProvider.authorizeDownload` performs no authorization |
| 24 | Export is distinct from download | `NOT IMPLEMENTED` | No export path exists |
| 25 | Time-bounded/secure delivery of content | `NOT IMPLEMENTED` | No signed URL, token or expiry mechanism |
| 26 | Document access is audited | `NOT ENFORCED` | Internal reads and projections emit no audit event |
| 27 | Disclosure and reveal are audited | `NOT ENFORCED` | Read-path projections emit no event |
| 28 | Denied attempts are auditable as policy events | `NOT ENFORCED` | Denials surface as SQL errors only |
| 29 | Purpose of access is recorded | `NOT IMPLEMENTED` | Audit records the action, not the purpose |
| 30 | Retention and disposal are controlled | `NOT IMPLEMENTED` | `REVOKED` never set; no delete path; no retention mechanism |
| 31 | One coherent sensitivity classification | `PARTIALLY ENFORCED` | Three uncoordinated vocabularies; one unconstrained |
| 32 | Exceptional access is bounded and audited | `PARTIALLY ENFORCED` | Verify grant only; no general mechanism |

## T. Enforcement Gap Register

| ID | Policy requirement | Current evidence | Status | Boundary at risk | Future dependency |
| --- | --- | --- | --- | --- | --- |
| **GAP-01** | One coherent sensitivity classification across all content classes | Three separate vocabularies: `documents.access_scope` (CHECK), `supplier_po_commercial_documents.classification` (CHECK), `verify_evidence_bindings.confidentiality_class` (**no CHECK**) | `PARTIALLY ENFORCED` | Consistent handling; a class with no vocabulary cannot be governed uniformly | Stage 009 |
| **GAP-02** | Access, download, export and external disclosure are four distinct authorizations | No download/export route exists; `DocumentsService.authorizeDownload` has no production call site | `NOT IMPLEMENTED` | The distinction would have to be invented at the moment egress is first built | Stage 009 |
| **GAP-03** | Embedded identity inside content and derivatives is controlled | No mechanism inspects, classifies or redacts content; filename, `source_metadata`, body and extraction are unscreened | `NOT IMPLEMENTED` | 006-C IC-9; partner/project confidentiality | Stage 009 |
| **GAP-04** | Derived content inherits ownership, purpose, confidentiality and disclosure restriction | Tenant confinement is structural coincidence; no propagation of `access_scope`/classification/purpose | `NOT ENFORCED` | Purpose boundary; a derivative of an internal document could surface in a tenant-visible table | Stage 009 |
| **GAP-05** | Content access, disclosure and reveal are audited | Upload, extraction, Verify **authorization intent** and alias creation are audited; ordinary access, projections, reveals and denials are not | `NOT ENFORCED` | Accountability; post-hoc evidence of who received what | Stage 009 |
| **GAP-06** | Retention and disposal are controlled and derivative-aware | `REVOKED` never set; no delete path; no retention mechanism | `NOT IMPLEMENTED` | Indefinite retention by default | **FOG-6**, then Stage 009 |
| **GAP-07** | Security-relevant APIs are not misleadingly named | `StorageProvider.authorizeDownload` performs key validation only and authorizes nothing | `NOT ENFORCED` | A future implementer could reasonably assume an authorization check occurs | Stage 009 |
| **GAP-08** | A general bounded exceptional-access mechanism exists | Only the Verify raw-review grant is implemented | `PARTIALLY ENFORCED` | Any non-Verify exceptional access would be ad hoc | Stage 009 |
| **GAP-09** | Document version lifecycle is exercised and governed | `document_versions` is never written by production code at this baseline | `NOT IMPLEMENTED` | Version-level classification and disposal are untested in practice | Stage 009 |
| **GAP-10** | Procurement document intake enforces an explicit permission | `POST /api/v1/procurement-documents/:id/extract` carries `AuthGuard` + `TenantGuard` but no `@RequirePermission` | `PARTIALLY ENFORCED` | Any authenticated tenant member may trigger extraction | Stage 009 or earlier remediation if separately authorized |
| **GAP-11** | Private storage posture is provable | Application creates no public or presigned URL, but bucket policy/ACL/deployment posture is **outside repository evidence** | `PARTIALLY ENFORCED` (evidence-limited) | A misconfigured bucket would bypass every application-level control | Infrastructure assurance, then Stage 009 |
| **GAP-12** | `storage_key` is never returned to any caller | No delivery path exposes it, but `DocumentsService.authorizeDownload` can return `{ storageKey }` in-process after tenant validation | `NOT ENFORCED` as a general guarantee | A future caller could surface the locator without any control objecting | Stage 009 |
| **GAP-13** | Raw-content opens are captured as evidence | `verify_raw_content_access_events` is immutable if populated, but has no production writer; only authorization *intent* is audited, with `contentDeliveryEnabled=false` | `NOT IMPLEMENTED` | The moment raw delivery is built, open-capture must exist with it | **FOG-4** context, then Stage 009 |

Gaps are assigned to Stage 009 only because the approved roadmap defines Stage 009 as **Sensitive Document Controls**. GAP-06 is additionally gated by FOG-6, since controls cannot be built against an undecided retention policy. No gap is assigned to an unauthorized Stage, and no implementation is prescribed.

## U. Stage 009 Prospective Requirements

Requirements only. No technology is selected; no design is specified.

| ID | Requirement | Derived from |
| --- | --- | --- |
| **R9-01** | A single sensitivity classification model must govern every content class, with a constrained vocabulary | GAP-01 |
| **R9-02** | Access, download, export and external disclosure must be separately authorizable and separately evidenced | GAP-02, section J |
| **R9-03** | Embedded identity in content, metadata and derivatives must be classifiable so that disclosure policy can be applied to it | GAP-03, section I |
| **R9-04** | Derived content must provably inherit ownership, purpose, confidentiality and disclosure restriction from its source | GAP-04, section K |
| **R9-05** | Content access, disclosure, reveal, transformation and denied attempts must be auditable as distinct event categories | GAP-05, section O |
| **R9-06** | Controlled reveal for content must enforce the six-element record, including separation of duties where warranted | GAP-08, section Q |
| **R9-07** | Retention and disposal must be controllable, derivative-aware, and must preserve immutable commercial history | GAP-06, section P — **gated by FOG-6** |
| **R9-08** | Content delivery must be bounded in time and scope, and must never expose a storage locator | GAP-02, section J |
| **R9-09** | Security-relevant interfaces must not imply guarantees they do not provide | GAP-07 |
| **R9-10** | Document and version lifecycle, including classification changes, must be governed and evidenced | GAP-09 |
| **R9-11** | Content policy must apply identically regardless of ingestion channel, including future external ingestion | section R |
| **R9-12** | Content policy enforcement must be expressible for non-human principals | section C.3 |
| **R9-13** | Private storage posture must be assured and verifiable beyond application code | GAP-11 |
| **R9-14** | The storage locator must be structurally incapable of reaching a caller | GAP-12 |
| **R9-15** | Any raw-content delivery capability must ship together with open-event capture | GAP-13 |

**Workspaces constraint, stated as a requirement rather than a design.** Digital Workspaces are an approved future capability under the principle that *the Partner does not enter SCO's office; SCO appears inside the Partner's company*. Any future Partner Private Workspace must obey this policy in full: content inside a Partner Workspace remains partner-owned, purpose-confined, and isolated by partner context, and workspace membership is not by itself content authorization. This contract designs no Workspace and no Service Access.

## V. Owner Gates & Owner Decisions

### V.1 Owner decisions required now

**NONE.**

Every rule in this contract follows from an already-approved Owner decision (Policy First, Controls Second; Default Deny for Cross-Purpose Reuse; Dynamic Identity Masking default to ALIAS or HIDDEN), from the closed 006-A/006-B/006-C contracts, or from direct repository evidence. No new Owner decision is needed to state a truthful sensitive-document policy, and none is manufactured.

Where a decision genuinely cannot be made now — retention durations — this contract explicitly defers to FOG-6 rather than inventing a schedule, and remains valid in the meantime.

### V.2 Future Owner gates

Carried forward unchanged and unresolved. **006-D creates no new gate.**

| Gate | Relevance to 006-D |
| --- | --- |
| **FOG-1** PI scope | Whether identifiable source or lineage material may become PI input (section N) |
| **FOG-2** PI feedback loops | Unaffected; not resolved |
| **FOG-3** Studies purpose | Study/engineering content classes cannot be defined until the purpose exists |
| **FOG-4** Verify secondary-use exception | Default denial already approved; only an exception needs a decision (section M) |
| **FOG-5** Supplier access context | Gates any document-bearing supplier disclosure path (section L.3) |
| **FOG-6** Retention / disposal | **Directly gates section P and R9-07**; the most 006-D-relevant gate |

## W. Explicit Non-Goals

006-D does **not** create, design, authorize or imply: document-control implementation, redaction, DLP, encryption, watermarking, download or export implementation, retention jobs, secure-delivery mechanisms, runtime code, schema, migrations, database changes, new APIs, authorization implementation, connector or integration implementation, Workspaces, Service Access, or an Agent/Principal model.

It does **not** modify 006-A, 006-B or 006-C; does not resolve FOG-1 … FOG-6; does not alter any ownership classification from 006-A, any purpose classification from 006-B, or any disclosure level from 006-C.

It does **not** authorize any new access or disclosure. Where it records a posture, that posture is the **maximum** permitted; it never widens an existing boundary.

## X. Acceptance Checklist

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Built from HEAD `c2f2ad4a37ef06995c75f08c5fdc52de24909271` | ✅ |
| 2 | Consistent with 006-A, 006-B, 006-C; no contradiction found | ✅ section A |
| 3 | Policy requirement, current enforcement, gap and future control kept separate | ✅ section B and throughout |
| 4 | No trust claim without evidence | ✅ section S — every `ENFORCED` row cites evidence |
| 5 | Sensitivity model is SCO-specific, not generic infosec | ✅ section D — four dimensions tied to SCO's commercial model |
| 6 | Content ≠ file only | ✅ section E — 13 classes incl. derived, metadata, storage locator |
| 7 | Purpose boundary preserved; no implicit cross-purpose bridge | ✅ sections F.6, L, N |
| 8 | Disclosure and identity rules preserved; embedded identity addressed | ✅ sections I, L |
| 9 | Download/export distinctions stated; current absence recorded honestly | ✅ section J |
| 10 | Derived content inheritance stated; gap recorded | ✅ section K, GAP-04 |
| 11 | Verify boundary preserved; FOG-4 untouched | ✅ section M |
| 12 | PI boundary preserved; FOG-1/FOG-2 unresolved | ✅ section N |
| 13 | Audit categories defined; no false purpose-aware audit claim | ✅ section O |
| 14 | Retention boundary stated without inventing a schedule | ✅ section P |
| 15 | Channel neutrality; integration cannot bypass policy | ✅ section R |
| 16 | Actor/principal-neutral wording | ✅ section C.3 |
| 17 | No new Owner gate; no manufactured current blocker | ✅ section V |
| 18 | Stage 009 requirements only, no implementation | ✅ section U |
| 19 | Nothing implemented | ✅ section W |

## Y. Evidence Index

### Migrations

| Migration | Evidence |
| --- | --- |
| `0004_rbac_audit_documents` | SCC-01, SCC-11, SCC-13 — `documents`, `document_versions`, `audit_logs`; `DocumentStatus` enum; FORCE RLS; `document_tenant`, `document_version_tenant`, `audit_tenant`, `audit_system_insert` |
| `0008_procurement_document_extraction` | SCC-02, SCC-03 — `procurement_documents`, `procurement_document_lines`; `procurement_document_tenant`, `procurement_line_tenant` |
| `0020_supplier_quote_document_access_isolation` | SCC-04 — `documents.access_scope` CHECK; redefined `document_tenant`; `supplier_quote_documents`; `get_supplier_quote_document` with capability gate, `REVOKE ALL … FROM PUBLIC`, EXECUTE to `sco_internal_executor` |
| `0046_supplier_commercial_document_foundation` | SCC-05, SCC-06 — `supplier_po_commercial_documents` with `document_type` and `classification` CHECKs; immutability triggers |
| `0058_delivery_site_tranche_foundation` | SCC-09 — `partner_delivery_sites` with `operational_label`, `delivery_alias NOT NULL UNIQUE`, `location_details`, `receiving_contact` |
| `0060_partner_supplier_delivery_projections` | Projection-based disclosure; state-gated reveal |
| `0061_buying_power_foundation` | SCC-10 — non-identifying aggregate key; identifiable lineage table |
| `0082_verify_foundation` | SCC-07, SCC-08 — raw content references; `verify_evidence_bindings` with `confidentiality_class` (no CHECK) and `integrity_version_reference`; raw-review grants with SoD and expiry CHECKs; immutable access events; document-validation triggers |
| `0085_internal_gateway_security_remediation` | Buy-side and supply-network revocation underpinning L.2 |

### Application code

| Path | Evidence |
| --- | --- |
| `apps/api/src/modules/documents/storage-provider.ts` | Provider contract; `createDocumentStorageProvider` environment restriction |
| `apps/api/src/modules/documents/development-storage.provider.ts` | Traversal rejection; `wx` write; sha256 |
| `apps/api/src/modules/documents/s3-storage.provider.ts` | Key validation rejecting empty/absolute/`.`/`..`; sha256; **`authorizeDownload` performs no authorization** |
| `apps/api/src/modules/documents/documents.service.ts` | Server-derived storage key; `authorizeDownload` with **no production call site** |
| `apps/api/src/modules/documents/supplier-quote-document.service.ts` | Metadata minimization; sole `readPrivate` call site; `forbidden()` without existence oracle |
| `apps/api/src/modules/documents/procurement-documents.service.ts` | Extraction within tenant transaction; extraction audit actions |
| `apps/api/src/modules/documents/documents.module.ts` | Only `ProcurementDocumentsController` registered |
| `apps/api/src/modules/documents/procurement-documents.controller.ts` | `AuthGuard` + `TenantGuard`, no `@RequirePermission` (GAP-10) |
| `apps/api/src/modules/audit/audit.service.ts` | Audit scope rules; secret-key filtering |

### Tests

| Path | Boundary proven |
| --- | --- |
| `apps/api/test/database/supplier-quote-document-isolation.integration.test.ts` | Authorized internal metadata and content **without a storage URL**; response has no `storageKey`/`absolutePath`/`url`; partner, supplier A, supplier B and dual buyer/supplier denied **without an existence oracle**; RLS hides private document metadata from runtime tenant **and spoofed internal settings**; `supplier_quote_documents` direct read denied |
| `apps/api/test/database/procurement-documents.integration.test.ts` | Tenant-scoped procurement document and line behaviour |
| `apps/api/test/database/supplier-commercial-document-foundation.integration.test.ts`, `…-verification.integration.test.ts` | Commercial document registration, coverage and verification immutability |
| `apps/api/test/database/verify-foundation-security.integration.test.ts` | Cross-company document and evidence rejection |
| `apps/api/test/database/verify-request-quote-lifecycle.integration.test.ts` | Gateway definition asserted not to reference `storage_key`/raw-content access |
| `apps/api/test/database/supplier-delivery-projection.integration.test.ts` | Supplier projection exact key set; alias prefix; direct access blocked |
| `apps/api/test/database/supplier-delivery-tranche-foundation.integration.test.ts` | Alias format and opacity; forged-alias INSERT denied |
| `apps/api/test/database/warranty-entitlement-foundation.integration.test.ts` | `storage_key` absent from partner projection |
| `apps/api/test/database/stage-003-adversarial-security.integration.test.ts` | Document existence-oracle resistance under runtime role |
| `apps/api/test/database/buy-side-trust-boundary.integration.test.ts` | Buy-side confidentiality underpinning L.2 |

### Negative evidence (searched at this baseline, not found)

| Search | Result | Consequence |
| --- | --- | --- |
| Any download/export/attachment/stream/`content-disposition`/`sendFile` route in any controller | **Not found** | GAP-02 |
| Signed URL / pre-signed URL / token / expiry delivery mechanism | **Not found** | GAP-02, R9-08 |
| Thumbnail, preview, watermark, redact, convert, render | **Not found** | Section K; GAP-03 |
| `DocumentStatus` `REVOKED` ever set | **Never set** | GAP-06 |
| `DELETE FROM documents` / `document_versions` | **Not found** | GAP-06 |
| `INSERT INTO document_versions` in production code | **Not found** | GAP-09 |
| Production call site for `DocumentsService.authorizeDownload` | **Not found** (test-only invocation exists) | GAP-02, GAP-07 |
