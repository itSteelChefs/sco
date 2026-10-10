# OSS admission matrix — 2026-10-10

This is an engineering record, not a license opinion. A candidate reaches product code only after the registry, provenance, security, data-flow, notices, exit path, and tests are complete.

| Capability | Candidate | Current decision | Product integration | Reason / next evidence |
| --- | --- | --- | --- | --- |
| A Reception | Existing SCO UI | Retain SCO implementation | No new OSS | The current CSS-module implementation is responsive and uses logical RTL properties. |
| Approved small UI scope | shadcn/ui: Button, Input, Label, Dialog, Progress | `APPROVED_FOR_INTEGRATION` | Not yet | May be manually copied only with exact provenance and a justified product slice. |
| B/C document viewer | Extend UI | `UNDER_EVALUATION` | No | Need pinned artifact, confidentiality/data-flow, Arabic/RTL and offline evidence. |
| B upload | Uppy | `CATALOG_APPROVED` | No | Current upload works; evaluate only for a proven resumable/direct-object-upload requirement. |
| C extraction | Docling / PaddleOCR | `CATALOG_APPROVED` | No | Synthetic Arabic, mixed Arabic/English, tables and resource-limit lab are prerequisites. |
| D comparison/import | TanStack Table / ExcelJS / ImportCSV | Catalog/evaluation only | No | Need a concrete buying-power/BOQ slice and file-parser threat review. |
| F workspace | Univer / OpenSeadragon / That Open | Catalog only | No | Not launch-critical; preserve canonical SCO storage and export proof. |
| H/I/J security | Gitleaks / Trivy | Existing CI integration | No scope expansion | Existing checksum-verified CI tooling remains the control. |

No provider or dependency is authorized to redefine SCO tenancy, permissions, lifecycle, audit, pricing, procurement, disclosure, or document authority.
