# Source custody policy

For every copied upstream source: identify the exact artifact; pin version/commit; retain license; record upstream path and source hash; manually review; copy only the approved files; preserve notice; record SCO modifications and local hash; test; sign the commit; and review upstream updates manually. Automated tools may validate records and hashes but must never overwrite product code or perform registry sync.

Custodied source lives under `docs/oss/custody/` only when source itself is documentation/evidence, or under the product's justified boundary with a matching provenance record. Absence of a provenance record is a validation failure.
