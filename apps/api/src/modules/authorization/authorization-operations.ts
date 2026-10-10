import { PURPOSE_REQUIREMENT, type PurposeRequirement } from '../rbac/purpose-registry.js';

export const AUTHORIZATION_OPERATION = {
  PARTNER_VERIFY_RESULT_READ: 'partner_verify.result.read',
  PARTNER_VERIFY_REQUEST_CREATE: 'partner_verify.request.create',
  PARTNER_VERIFY_QUOTE_ATTACH: 'partner_verify.quote.attach',
  PARTNER_VERIFY_REQUEST_SUBMIT: 'partner_verify.request.submit',
  PROCUREMENT_DOCUMENT_EXTRACT: 'procurement_document.extract',
  PARTNER_JOURNEY_READ: 'partner_journey.read',
  PARTNER_WORKSPACE_READ: 'partner_workspace.read',
  PARTNER_WORKSPACE_PROVISION: 'partner_workspace.provision',
  PARTNER_COLLABORATION_LIST: 'partner_collaboration.list',
  PARTNER_COLLABORATION_CREATE: 'partner_collaboration.create',
  PARTNER_COLLABORATION_READ: 'partner_collaboration.read',
  PARTNER_COLLABORATION_ARCHIVE: 'partner_collaboration.archive',
  PARTNER_COLLABORATION_PARTICIPATION_GRANT: 'partner_collaboration_participation.grant',
  PARTNER_COLLABORATION_PARTICIPATION_REVOKE: 'partner_collaboration_participation.revoke',
  PARTNER_COLLABORATION_PARTICIPATION_JOIN: 'partner_collaboration_participation.join',
  PARTNER_COLLABORATION_PARTICIPATION_LEAVE: 'partner_collaboration_participation.leave',
} as const;

export type AuthorizationOperation = (typeof AUTHORIZATION_OPERATION)[keyof typeof AUTHORIZATION_OPERATION];
export type ResourceKind = 'VERIFY_REQUEST' | 'PROCUREMENT_DOCUMENT' | 'COMPANY' | 'COLLABORATION' | 'PARTICIPATION';

export type OperationDescriptor = {
  // A single permission, or any-of for the few operations whose actors legitimately hold one of several RBAC grants.
  readonly permission: string | { readonly anyOf: readonly string[] };
  readonly purpose: PurposeRequirement;
  // null = any ACTIVE company type. Otherwise the tenant company must be ACTIVE and of one of these types.
  readonly companyTypes: readonly string[] | null;
  // Applies the Class D Partner gate (Active Partner + required agreements incl. Binding Confidentiality).
  readonly partnerClassD: boolean;
  // Resource-bound operations declare the route parameter that carries the resource id. Only its presence and shape
  // are validated here; ownership stays with the downstream authoritative boundary. A null routeParam declares a
  // resource-less operation that acts on the tenant company itself (kind 'COMPANY'); no resource id is accepted.
  readonly resource: { readonly kind: ResourceKind; readonly routeParam: string | null };
};

const registry: Readonly<Record<AuthorizationOperation, OperationDescriptor>> = Object.freeze({
  [AUTHORIZATION_OPERATION.PARTNER_VERIFY_RESULT_READ]: Object.freeze({
    permission: 'partner_verify.read',
    purpose: PURPOSE_REQUIREMENT.VERIFY,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'VERIFY_REQUEST', routeParam: 'requestId' }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_VERIFY_REQUEST_CREATE]: Object.freeze({
    permission: 'partner_verify.write',
    purpose: PURPOSE_REQUIREMENT.VERIFY,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'COMPANY', routeParam: null }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_VERIFY_QUOTE_ATTACH]: Object.freeze({
    permission: 'partner_verify.write',
    purpose: PURPOSE_REQUIREMENT.VERIFY,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'VERIFY_REQUEST', routeParam: 'requestId' }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_VERIFY_REQUEST_SUBMIT]: Object.freeze({
    permission: 'partner_verify.write',
    purpose: PURPOSE_REQUIREMENT.VERIFY,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'VERIFY_REQUEST', routeParam: 'requestId' }),
  }),
  [AUTHORIZATION_OPERATION.PROCUREMENT_DOCUMENT_EXTRACT]: Object.freeze({
    permission: 'procurement_document.extract',
    purpose: PURPOSE_REQUIREMENT.DOCUMENT_CUSTODY,
    companyTypes: null,
    partnerClassD: true,
    resource: Object.freeze({ kind: 'PROCUREMENT_DOCUMENT', routeParam: 'id' }),
  }),
  // Class C basic Partner shell: deliberately not a Class D operation and not gated on Active Partner status.
  // Onboarding Partners may hold partner.admission.read before partner.portal.read is configured.
  [AUTHORIZATION_OPERATION.PARTNER_JOURNEY_READ]: Object.freeze({
    permission: Object.freeze({ anyOf: Object.freeze(['partner.portal.read', 'partner.admission.read']) }),
    purpose: PURPOSE_REQUIREMENT.AUTHORIZATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: false,
    resource: Object.freeze({ kind: 'COMPANY', routeParam: null }),
  }),
  // Class C basic Partner private workspace shell. Deliberately not Class D: no ACTIVE relationship, agreement,
  // operational access or entitlement is required, so onboarding/remediation context survives a RESTRICTED state.
  [AUTHORIZATION_OPERATION.PARTNER_WORKSPACE_READ]: Object.freeze({
    permission: 'partner.portal.read',
    purpose: PURPOSE_REQUIREMENT.AUTHORIZATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: false,
    resource: Object.freeze({ kind: 'COMPANY', routeParam: null }),
  }),
  // Idempotent "ensure the company's one private workspace exists". Not workspace administration or an update.
  [AUTHORIZATION_OPERATION.PARTNER_WORKSPACE_PROVISION]: Object.freeze({
    permission: 'partner.portal.read',
    purpose: PURPOSE_REQUIREMENT.AUTHORIZATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: false,
    resource: Object.freeze({ kind: 'COMPANY', routeParam: null }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_LIST]: Object.freeze({
    permission: 'partner.collaboration.read',
    purpose: PURPOSE_REQUIREMENT.COLLABORATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'COMPANY', routeParam: null }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_CREATE]: Object.freeze({
    permission: 'partner.collaboration.create',
    purpose: PURPOSE_REQUIREMENT.COLLABORATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'COMPANY', routeParam: null }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_READ]: Object.freeze({
    permission: 'partner.collaboration.read',
    purpose: PURPOSE_REQUIREMENT.COLLABORATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'COLLABORATION', routeParam: 'collaborationId' }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_ARCHIVE]: Object.freeze({
    permission: 'partner.collaboration.manage',
    purpose: PURPOSE_REQUIREMENT.COLLABORATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'COLLABORATION', routeParam: 'collaborationId' }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_PARTICIPATION_GRANT]: Object.freeze({
    permission: 'partner.collaboration.participation.manage',
    purpose: PURPOSE_REQUIREMENT.COLLABORATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'COLLABORATION', routeParam: 'collaborationId' }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_PARTICIPATION_REVOKE]: Object.freeze({
    permission: 'partner.collaboration.participation.manage',
    purpose: PURPOSE_REQUIREMENT.COLLABORATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'PARTICIPATION', routeParam: 'participationId' }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_PARTICIPATION_JOIN]: Object.freeze({
    permission: 'partner.collaboration.participate',
    purpose: PURPOSE_REQUIREMENT.COLLABORATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'PARTICIPATION', routeParam: 'participationId' }),
  }),
  [AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_PARTICIPATION_LEAVE]: Object.freeze({
    permission: 'partner.collaboration.participate',
    purpose: PURPOSE_REQUIREMENT.COLLABORATION,
    companyTypes: Object.freeze(['PARTNER']),
    partnerClassD: true,
    resource: Object.freeze({ kind: 'PARTICIPATION', routeParam: 'participationId' }),
  }),
});

export function operationDescriptor(operation: unknown): OperationDescriptor | undefined {
  if (typeof operation !== 'string' || !Object.hasOwn(registry, operation)) return undefined;
  return registry[operation as AuthorizationOperation];
}

// Registry contract checks, asserted by tests. Combining Class D with an any-of permission would silently widen the
// reviewed Class D composition; it needs an explicit future contract change.
export function registryInvariantViolations(entries: Readonly<Record<string, Pick<OperationDescriptor, 'permission' | 'partnerClassD'>>>): string[] {
  return Object.entries(entries).flatMap(([operation, descriptor]) =>
    descriptor.partnerClassD && typeof descriptor.permission !== 'string'
      ? [`${operation}: Class D operations must use a single permission, not anyOf`]
      : []);
}
