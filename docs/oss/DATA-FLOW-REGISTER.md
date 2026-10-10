# OSS data-flow register

| Candidate class | Present data flow | Admission boundary |
| --- | --- | --- |
| Current UI and proposed shadcn primitives | Browser-local rendering only | No telemetry, remote configuration, or identity authority. |
| Document viewer/OCR candidates | None; not integrated | Confidential documents remain inside SCO-controlled infrastructure. Any later processing needs sandboxing, bounded resources, no ambient external fetches, and deletion/retention controls. |
| Upload candidates | None; not integrated | Any direct upload uses existing SCO authorization, object-policy, size/type/virus controls and audit design; the library does not become authorization authority. |
| CI security tools | CI filesystem/container scanning | Release binaries are checksum verified; scan output must not expose secrets. |

A missing or unknown flow is a block on confidential-document promotion. Provider telemetry and hosted-processing defaults must be explicitly disabled or rejected before admission.
