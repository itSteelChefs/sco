# Procurement Release Implementation Plan

> **For agentic workers:** Use the existing database gateway and real PostgreSQL integration tests.

**Goal:** Add Batch 9.5's atomic, auditable Procurement Release boundary from FUNDED through release and withdrawal.

**Architecture:** A forward-only migration introduces immutable release snapshots, line snapshots, funding allocations/deallocations, and supplier reconfirmations. SECURITY DEFINER gateways perform capability checks, lock commitments/funds, validate all lines, and write release plus audit atomically.

**Tech Stack:** PostgreSQL PL/pgSQL gateways, Nest internal database service, Vitest real PostgreSQL tests.

**Global Constraints:** Migrations 0013–0032 remain unchanged; no Supplier PO, payment execution, delivery, automatic FX, or Batch 9.6 work.

### Task 1: Migration and security boundary
- Create `0033_procurement_release` with lifecycle types, protected tables, RLS/FORCE RLS, least-privilege grants, immutable triggers, capabilities, and release/withdraw gateways.

### Task 2: Application gateway
- Add typed `InternalDatabaseService` methods for release, reconfirmation, and withdrawal.

### Task 3: Real PostgreSQL acceptance tests
- Add focused tests covering funding, partial/multi-line release, rollback, withdrawal, isolation, immutability, and concurrency; run them against real roles.

### Task 4: Regression verification
- Run Batch 9.4–9.1 and relevant Batch 8 suites, typecheck, and diff checks. Stop on any business blocker.
