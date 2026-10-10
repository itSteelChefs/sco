# License admission policy

This is engineering intake guidance, not legal advice. A specific pinned artifact is reviewed before any promotion.

| Class | Engineering default | Promotion rule |
| --- | --- | --- |
| Permissive (MIT, BSD, Apache-2.0) | Technically admissible, not automatically adopted | license, security, fit, notices, exit path |
| Weak copyleft | Analyze distribution and modification obligations | `LEGAL_REVIEW_REQUIRED=YES` where obligations are unclear |
| Strong/network copyleft | Heightened review | no integration promotion without explicit legal decision |
| Source-available/commercial/open-core/custom | Treat as ambiguous | `LEGAL_REVIEW_REQUIRED=YES`; no integration promotion |
| Unknown | Not admitted | pin artifact and determine license first |

Never remove upstream notices or represent upstream projects as SCO-owned.
