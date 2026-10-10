# Ownership register

| Asset | Classification | Ownership statement |
| --- | --- | --- |
| Existing partner/operations UI, contracts, API, tenant and permission model | SCO-ORIGINAL / SCO-COMPOSITION | SCO owns its authored code and product composition. |
| Existing CI security scripts and pinned configuration | SCO-CONFIGURATION | SCO owns policy/configuration; tool rights remain upstream. |
| Trivy and Gitleaks binaries | UPSTREAM-OWNED | Used under their upstream licenses; SCO owns only integration/configuration. |
| Future shadcn selected source | UPSTREAM-OWNED plus SCO-MODIFIED/SCO-COMPOSITION if changed | SCO does not own shadcn; it may own permitted modifications and integration. |
| Future adapters | SCO-ADAPTER | SCO-owned contract boundaries protect replacement. |

No current source-custodied shadcn files exist, so no upstream source is claimed as SCO-owned.
