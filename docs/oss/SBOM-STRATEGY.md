# SBOM strategy

`node scripts/oss/generate-sbom.mjs --output <file>` emits a deterministic SPDX-like JSON inventory tied to `git rev-parse HEAD`. It covers direct workspace dependencies and installed metadata available to the script. It does not claim OS, container, transitive, or external-service completeness; container release builds already request BuildKit SBOM/provenance metadata.

Generate an SBOM from the release SHA after frozen-lockfile install and retain it with release evidence.
