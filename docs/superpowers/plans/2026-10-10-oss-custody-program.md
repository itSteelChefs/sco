# OSS Custody Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish reproducible SCO OSS governance, provenance, notices, and supply-chain evidence without expanding product scope.

**Architecture:** `docs/oss/` is the single source of truth for policy and machine-readable status. `scripts/oss/` validates registry integrity and generates an SPDX-like inventory from installed dependency metadata. Product integration is deliberately limited to an evidence decision: no new UI/document/OCR dependency is added unless a separate approved product need exists.

**Tech Stack:** Node.js 20, pnpm workspace metadata, JSON, Markdown.

**Spec:** Owner directive “SCO Master Build Roadmap — Post-Stage016 / Launch Core”.

## Global Constraints

- Baseline: `45e0c8d822f52c56a3370268aa4e54d17df60a77`.
- No Stage017, deployment, push, DNS, or production/preview access.
- No uncontrolled registry CLI or new product OSS family.
- Preserve upstream ownership and notices; do not claim SCO owns upstream.
- All product state, contracts, permissions, and domain logic remain SCO-owned.

## Review Focus

- A new direct dependency lacks a registry record and must fail governance validation.
- A custodied file lacks provenance or a matching local hash and must fail validation.
- An unapproved shadcn component appears in custody and must fail validation.
- A registry record claims integration without required provenance/review fields and must fail validation.
- SBOM output must be tied to the checked-out Git SHA and declare its scope limitations.

---

### Task 1: OSS source of truth and policies

**Files:** `docs/oss/*`, `docs/superpowers/plans/2026-10-10-oss-custody-program.md`

- [ ] Create registry/provenance and concise policy documents.
- [ ] Document ownership, notices, security/data-flow, replacement and update rules.
- [ ] Commit governance-only changes.

### Task 2: Reproducible checks and SBOM readiness

**Files:** `scripts/oss/check.mjs`, `scripts/oss/inventory.mjs`, `scripts/oss/generate-sbom.mjs`, `scripts/oss/*.test.mjs`

- [ ] Write failing validation tests for missing direct-dependency records and unsupported statuses.
- [ ] Implement deterministic validation and SPDX-like JSON output without network resolution.
- [ ] Run tests and commit tooling.

### Task 3: Evidence and admission preparation

**Files:** `docs/oss/*`, `/tmp/sco-codex2-oss-custody/*`

- [ ] Audit existing UI and retain local components where no product need justifies shadcn adoption.
- [ ] Evaluate document/OCR and future D/F/H-I-J candidates without integration.
- [ ] Run relevant checks/builds, produce SHA-bound evidence, sign commits, and hand off.
