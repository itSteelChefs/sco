# Resource Authorization Composition (H1)

Status: candidate. H1 is application/domain composition over existing authoritative facts. No migration `0103` is
required and no migration, schema, RLS, grant or function was changed.

## Scope

H1 covers exactly two HTTP operations:

| Operation | Route | Permission | Purpose |
| --- | --- | --- | --- |
| `partner_verify.result.read` | `GET /api/v1/partner/verify/requests/:requestId/result` | `partner_verify.read` | VERIFY (PUR-14) |
| `procurement_document.extract` | `POST /api/v1/procurement-documents/:id/extract` | `procurement_document.extract` | DOCUMENT_CUSTODY (PUR-15) |

Both keep the 0102 Class D contract: for a PARTNER company, an Active Partner with Binding Confidentiality (via
`partner_procurement_access_allowed_for_current_actor()`), plus the operation permission and the registry purpose.
Verify additionally requires a PARTNER company. Entitlement is not a generic requirement of H1.

## What H1 composes

`ResourceAuthorizationService` (`apps/api/src/modules/authorization/`) evaluates fixed layers; the first failing layer
denies and any evaluation error denies (`AUTHORIZATION_UNAVAILABLE`):

1. `CONTEXT` – server-derived actor/tenant context is present and well-formed.
2. `OPERATION` – the operation exists in the closed registry (`authorization-operations.ts`).
3. `RESOURCE_CONTEXT` – the registry-declared route resource id is present and UUID-shaped.
4. `MEMBERSHIP` – ACTIVE membership in an ACTIVE company, matching the supplied membership id.
5. `COMPANY` – the company type is eligible for the operation.
6. `PERMISSION` – the membership holds the operation permission.
7. `PURPOSE` – the purpose is owned by the registry; a differing declaration is denied.
8. `PARTNER_ELIGIBILITY` – the Class D Partner gate above.

The service owns no state and no domain transition.

## What H1 does not do

- `ResourceAuthorizationGuard` validates the registry-declared route resource identity and shape only. It does **not**
  independently resolve resource ownership.
- Verify request ownership is finally enforced by the specialized Verify gateway
  (`partner_verify_result_get`), tenant context/RLS and the purpose-decision chain.
- Procurement document ownership is finally enforced by tenant RLS and the document domain service.
- Foreign existing resources keep their downstream safe-not-found behavior (404). A malformed resource id returns the
  uniform 403 before any database access to the resource.
- Workspace/Project composition is not part of H1. It may be introduced later only for a real operation with an
  explicit authorization contract.
- Service Access and Controlled Disclosure remain separate; Service Access never creates Partner membership.
- No generic authorization engine exists; the specialized DB gateways remain authoritative.
- H1 does not repair legacy opt-in `PermissionGuard`/`PurposeGuard` behavior on routes that do not use
  `ResourceAuthorizationGuard`.
- A route using `ResourceAuthorizationGuard` without a registered `@AuthorizeOperation(...)` fails closed.
- `ProcurementDocumentsService.extract` keeps its own Class D check as service-level defence in depth.

## Audit semantics

One final-outcome event per request, with no sensitive payload:

| Outcome | Event | `authorizationDecision` |
| --- | --- | --- |
| Final allow | `authorization.purpose_allowed` | `ALLOWED` |
| Denied at the purpose layer | `authorization.purpose_denied` (metadata: operation, layers, failed layer, reason) | `DENIED` |
| Denied at any other layer, including after purpose passed | `authorization.operation_denied` (same metadata) | `DENIED` |

A denied request never produces an `ALLOWED` event. Requests without an attributable tenant/operation (missing actor,
malformed context, unknown operation) produce no tenant audit row.

## Evidence

- `test/database/resource-authorization-composition.integration.test.ts` – composition, audit and guard contract.
- `test/integration/partner-verify-http.integration.test.ts` – real HTTP Verify adversarial coverage.
- `test/integration/procurement-documents-http.integration.test.ts` – real HTTP document extraction coverage.
