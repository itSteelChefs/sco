# H3 — Partner Private Workspace Authorization Composition and Operationalization

Status: candidate. No migration, schema, RLS, grant or function change. The durable workspace foundation (Stage 012,
migration 0101) is reused unchanged: `partner_workspaces`, `partner_workspace_project_links`,
`partner_workspace_document_references`, `partner_workspace_capability_projection(...)`, their RLS/FORCE RLS and the
Service Access summary function.

## What H3 does

| Concern | Before | After |
| --- | --- | --- |
| HTTP authorization of `GET`/`POST /api/v1/partner/workspace/current` | legacy `PermissionGuard` + `PurposeGuard` | H1 `ResourceAuthorizationGuard` with `partner_workspace.read` / `partner_workspace.provision` |
| Non-PARTNER company | reached the DB trigger and surfaced as a 500 | denied by H1 `companyTypes` (403), nothing created |
| Authorization audit | `authorization.purpose_allowed` written before later layers could still deny | one H1 final-outcome event per request |
| Controller DI | constructor without `@Inject` (broke under vitest) | `@Inject(WorkspaceService)` |
| Capability list | every ACTIVE entitlement code returned to any `partner.portal.read` holder | registry-mapped capabilities composed from entitlement x permission x H2 operational access |

## Operations (H1)

Both are resource-less Class C operations: permission `partner.portal.read`, purpose AUTHORIZATION (PUR-02),
`companyTypes: ['PARTNER']`, `partnerClassD: false`. They do not require an ACTIVE relationship, Binding Confidentiality,
operational access or an entitlement, so the shell and onboarding/remediation context survive a RESTRICTED state.

`partner_workspace.provision` means only "ensure the company's single private workspace exists" (idempotent, existing
semantics: advisory lock + `ON CONFLICT DO NOTHING`). There is no update, PATCH, PUT or DELETE route; the existing
`partner_workspace.created` material-state audit is unchanged. The DB trigger (ACTIVE PARTNER company, immutable
`company_id`) remains an independent backstop.

## Capability projection (advisory)

`WORKSPACE_CAPABILITY_REGISTRY` (application level, no durable state) maps an entitlement `serviceCode` to a public
capability id, one existing permission, and whether H2 operational access is required. Per request, nothing cached:

1. entitlement: the existing DB projection (ACTIVE `service_entitlements`) is an input only;
2. permission: the actor must hold the mapped permission, otherwise the capability is omitted (nothing disclosed);
3. operational access: only when the capability needs it, the existing Class D gate decides; if RESTRICTED the
   capability is listed `available: false` with `reason: 'OPERATIONAL_ACCESS_RESTRICTED'`.

Unknown/unmapped codes, including internal support-consent codes (`PARTNER_CONTEXT_SUPPORT`,
`PARTNER_WORKSPACE_SUPPORT`), are never returned. The response keeps `capabilities: string[]` (currently available) and
adds `capabilityStates` (additive, optional in `@sco/contracts`). The state is advisory display data and is never an
authorization decision: every operation behind a capability enforces its own H1 authorization, and advisory
availability writes no authorization audit.

The production registry is **intentionally empty**: no Partner-visible, service-bound capability exists in the repository
today, and mapping Verify or documents would contradict their closed contracts (not entitlement-bound). Adding a
capability is one entry reusing an existing permission code; no new permission or migration is involved.

## Explicitly not in H3

Projects (list/detail/membership authority), documents (list, metadata, download, any storage locator), an SCO-assisted
HTTP route, UI, public registration, realtime/collaboration, meetings/rooms/presence, new permissions, new durable
state. Workspace access grants no project or document authority; Stage 008/009 remain authoritative.

## Residual observations (not changed, not claimed fixed)

- `sco_runtime` still holds INSERT/UPDATE on `partner_workspaces` (0101). No H3 route exposes an update path.
- `partner_workspace_capability_projection` accepts `p_actor` without binding it to `app.actor_id`; the application
  always passes the authenticated `tenant.userId`.
- Service Access authorization does not re-check that the target company is still ACTIVE.
- `project_members`/`projects` are runtime-writable with no authoritative project-access consumer; not used by H3.

## Evidence

`test/integration/partner-workspace-http.integration.test.ts` (real HTTP, plus pure registry/composition contract).
