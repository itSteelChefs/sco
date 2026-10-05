import { PURPOSE_REQUIREMENT, type PurposeRequirement } from '../rbac/purpose-registry.js';

export const AUTHORIZATION_OPERATION = {
  PARTNER_VERIFY_RESULT_READ: 'partner_verify.result.read',
  PROCUREMENT_DOCUMENT_EXTRACT: 'procurement_document.extract',
  PARTNER_JOURNEY_READ: 'partner_journey.read',
} as const;

export type AuthorizationOperation = (typeof AUTHORIZATION_OPERATION)[keyof typeof AUTHORIZATION_OPERATION];
export type ResourceKind = 'VERIFY_REQUEST' | 'PROCUREMENT_DOCUMENT' | 'COMPANY';

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
