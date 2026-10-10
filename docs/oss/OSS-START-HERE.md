# SCO OSS start here

Use OSS only through the registry at `docs/oss/registry.json`.

1. Status moves only through `CATALOG_APPROVED` → `UNDER_EVALUATION` → `APPROVED_FOR_INTEGRATION` → `INTEGRATED_EVIDENCED`; rejection is `REJECT_FOR_CURRENT_PROGRAM`.
2. A catalog record is not permission to install, copy, or call a registry CLI.
3. Preserve upstream copyright and license notices. SCO owns only its permitted modifications, adapters, composition, contracts, and domain logic.
4. Copy source only after pinning upstream artifact/version, recording hashes and license, and passing review.
5. Do not introduce hosted processing, telemetry, OCR, document viewers, or a runtime dependency without data-flow and security evidence.
6. Every integration needs an SCO-owned boundary, export/replacement plan, and manual upstream-update review.
7. Run `node scripts/oss/check.mjs` before committing OSS governance or custody changes.

Prohibited: uncontrolled package installation, blind source copying, automatic registry sync, notice removal, upstream ownership claims, and confidential-document egress.
