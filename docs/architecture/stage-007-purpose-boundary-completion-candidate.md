# Stage 007 — Purpose Boundary Remediation Candidate

## Scope and baseline

This record covers baseline `eaedfa89cd7a750d6fe5e0104b364d430d2c8dc8` and uncommitted Stage 007 remediation. It records implemented boundaries only; a registry entry is not runtime authority.

## Registry, operation binding, and authorization

The Stage-006-B registry defines 18 `PUR-*` purposes and 41 `CPF_*` entries. It is a contract registry, not an operation router.

`PurposeRequirement` is a discriminated union:

- `PURPOSE_ONLY` has no CPF and is used where a route genuinely needs only a purpose.
- `CROSS_PURPOSE_FLOW` requires a complete registered CPF, and its purpose must equal the registered target.

The authorization predicate verifies the exact CPF ID, source, target, status, and target-purpose relationship. Unknown, substituted, omitted, default-denied, owner-decision, and not-implemented flows fail closed.

## Classification and executable inventory of the CPF registry

The repository-wide source scan for `CPF_*`, `PURPOSE_FLOW`, `CROSS_PURPOSE_FLOW`, `createNeed`, `procurement_needs`, and `internal_procurement_need_create` found one current Stage-007 cross-purpose operation: CPF_03. The other entries below are contract registry entries; a historical domain gateway, RLS policy, or projection is not represented as Stage-007 CPF authorization unless it has a trusted operation binding.

| CPF | Classification | Current runtime evidence |
| --- | --- | --- |
| CPF_01 | REGISTERED ONLY | Purpose-only identity context; no Stage-007 CPF operation binding. |
| CPF_02 | REGISTERED ONLY | Purpose-only authorization context; no Stage-007 CPF operation binding. |
| CPF_03 | IMPLEMENTED INTERNAL CAPABILITY; OPERATION-BOUND; ENFORCED AT INTERNAL GATEWAY; NOT CURRENTLY PRODUCT-REACHABLE | `PlanningService.createNeed` → `InternalDatabaseService.createProcurementNeed` → `internal_procurement_need_create`; no production Controller, worker, or other production caller invokes `PlanningService.createNeed`; runtime DML and runtime execute are denied. |
| CPF_04 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_05 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_06 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_07 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_08 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_09 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_10 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_11 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_12 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_13 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_14 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_15 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_16 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_17 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_18 | REGISTERED ONLY | Document extraction is purpose-only; no CPF chosen by the route or client. |
| CPF_19 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_20 | REGISTERED ONLY | Verify has separate server-issued authority; no Stage-007 CPF operation binding. |
| CPF_21 | NOT IMPLEMENTED | Registry status rejects the flow. |
| CPF_22 | REGISTERED ONLY | Partner Verify result uses separate one-time Verify authority, not a Stage-007 cross-purpose binding. |
| CPF_23 | DENIED_BY_DEFAULT | Registry status rejects the flow. |
| CPF_24 | DENIED_BY_DEFAULT | Registry status rejects the flow. |
| CPF_25 | DENIED_BY_DEFAULT | Registry status rejects the flow. |
| CPF_26 | DENIED_BY_DEFAULT | Registry status rejects the flow. |
| CPF_27 | DENIED_BY_DEFAULT | Registry status rejects the flow. |
| CPF_28 | DENIED_BY_DEFAULT | Registry status rejects the flow. |
| CPF_29 | DENIED_BY_DEFAULT | Registry status rejects the flow. |
| CPF_30 | DENIED_BY_DEFAULT | Registry status rejects the flow. |
| CPF_31 | DENIED_BY_DEFAULT | Registry status rejects the flow. |
| CPF_32 | DENIED_BY_DEFAULT | Registry status rejects the flow. |
| CPF_33 | REGISTERED ONLY | No Stage-007 CPF operation binding. |
| CPF_34 | OWNER-DECISION GATED | Registry status rejects the flow. |
| CPF_35 | OWNER-DECISION GATED | Registry status rejects the flow. |
| CPF_36 | OWNER-DECISION GATED | Registry status rejects the flow. |
| CPF_37 | OWNER-DECISION GATED | Registry status rejects the flow. |
| CPF_38 | OWNER-DECISION GATED | Registry status rejects the flow. |
| CPF_39 | NOT IMPLEMENTED | Registry status rejects the flow. |
| CPF_40 | NOT IMPLEMENTED | Registry status rejects the flow. |
| CPF_41 | REGISTERED ONLY | Audit is evidence, not a caller-selectable Stage-007 cross-purpose operation. |

CPF_22 remains part of the approved registry, but no new CPF_22 operation binding was introduced by this remediation. It must not be used to bridge Verify into procurement, pricing, offer, supplier, PI, or any other purpose.

## CPF_03 procurement-need intake boundary

The implemented internal operation path is `PlanningService.createNeed` → `InternalDatabaseService.createProcurementNeed` → the `SECURITY DEFINER` function `internal_procurement_need_create`. A production call-site scan found no Controller, worker, or other production caller of `PlanningService.createNeed`; therefore CPF_03 is not currently product-reachable. It remains registered, implemented, operation-bound, and enforced at its internal database gateway. Registered is not enforcement, and implemented is not product reachability.

The planning service creates a UUID correlation ID server-side after trusted tenant context has been established and carries it through the typed internal database call. The gateway persists that UUID with the success audit in its transaction. If an intended internal executor omits the value, the gateway derives a UUID itself, so a successful CPF_03 audit cannot have an empty correlation ID. Correlation is evidence only: it is neither a client authorization input nor an authorization substitute, and membership, company, partnership, project, purpose, and CPF checks remain independent.

Before the insert it verifies:

1. active membership for the trusted actor and company;
2. an active `BUYER_PARTNERSHIP` for that same company;
3. a same-company project when a project is supplied.

The function writes both the procurement need and its success audit event in the same database transaction. The audit evidence includes actor, company, action, entity, outcome, correlation ID, `PUR-05`, `CPF_03`, `PUR-03`, and `PUR-05`. It does not include request documents, credentials, cookies, or raw payloads. A transaction rollback leaves neither the need nor its success audit.

The uncommitted `0095_stage_007_cpf_03_operation_binding` migration contains this correction because no committed migration is changed. Migrations `0001` through `0094` remain immutable and unchanged. It revokes `INSERT`, `UPDATE`, and `DELETE` on `procurement_needs` from `sco_runtime`, replacing the former tenant-only DML path with a read-only tenant policy. `PUBLIC` and `sco_runtime` cannot execute the gateway. RLS remains tenant isolation; the narrowly scoped gateway owns the partnership prerequisite.

Denied database attempts fail before a need or success audit can be written. Route-level purpose denials continue to record `authorization.purpose_denied` through the purpose guard, with CPF evidence when the rejected trusted requirement is cross-purpose.

## Composition and non-goals

CPF checks do not replace authentication, tenant resolution, active membership, RBAC, partnership prerequisites, or document disclosure controls. Procurement document extraction remains authentication -> tenant -> `procurement_document.extract` -> purpose -> extraction action.

Verify retains backend/transaction binding, actor and company binding, expiration, single use, replay denial, and forgery denial. No Verify bridge was introduced. Stage 008/009 disclosure, masking, delivery, retention, supplier context, PI activation, workspace, agent, and connector work remain out of scope.

## Validation executed in this remediation

| Check | Result |
| --- | --- |
| Purpose authorization, planning, and Stage-006-B registry unit tests | Passed: 9 tests. The correspondence test parses every authoritative row, requires 18 unique purpose IDs and 41 unique CPF IDs, rejects malformed/unknown IDs, endpoints, statuses, duplicates, and unexpected rows, and verifies bidirectional exact registry correspondence. |
| CPF_03 isolated database integration | Passed: 6 tests after disposable `sco_test` setup at `127.0.0.1:55432` with `SCO_TEST_DATABASE=1`. |
| Full API database regression | Passed: 54 files / 461 tests (18 + 431 + 12 test groups), through the disposable test harness. |
| Full API integration regression | Passed: 6 files / 45 tests, through the disposable test harness. |
| Partner and Operations tests | Passed: 2 tests each. |
| API, Partner, and Operations builds | Passed. |
| Playwright browser E2E | Passed: 11 Chromium tests, including Partner login failure handling, Operations login, company context behavior, session expiry, server-side logout invalidation, old-cookie replay rejection, and logout failure recovery. |
| Workflow security and migration integrity | `actionlint` passed; migration integrity passed with 95 directories and unchanged historical baseline. |
| `git diff --check` | Passed. |

The CPF_03 database test covers a valid active buyer partnership; inactive membership; missing, inactive, wrong-type, wrong-company, and cross-tenant partnerships; correlation cannot grant authorization; runtime direct insert; runtime direct gateway invocation; rollback atomicity; trusted correlation persistence and database fallback generation; revoked runtime DML; denied PUBLIC/runtime execute; allowed intended-executor execute; `SECURITY DEFINER`, owner, `search_path`, and RLS/FORCE RLS state.
