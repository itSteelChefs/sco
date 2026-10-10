# Third-party notices

This repository currently consumes packages through pnpm and pinned CI release binaries. The reproducible direct-dependency inventory is generated with `node scripts/oss/inventory.mjs`; it reads installed package metadata and does not invent licenses from the lockfile.

For release notice production, retain the generated inventory with the release SHA and add the exact upstream license text/notice required by the resolved artifact. This document is intentionally not an unfiltered lockfile dump. No source-custodied upstream component has been added by this OSS program.

Material existing tooling: Gitleaks 8.30.1 and Trivy 0.74.0 are downloaded from official releases after checksum verification by `scripts/ci/install-security-tools.sh`. Their upstream rights and notices remain with their respective owners.
