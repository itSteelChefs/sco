import { PURPOSE_REQUIREMENT, type PurposeRequirement } from '../rbac/purpose-registry.js';

export const AUTHORIZATION_OPERATION = {
  PARTNER_VERIFY_RESULT_READ: 'partner_verify.result.read',
  PROCUREMENT_DOCUMENT_EXTRACT: 'procurement_document.extract',
} as const;

export type AuthorizationOperation = (typeof AUTHORIZATION_OPERATION)[keyof typeof AUTHORIZATION_OPERATION];
export type ResourceKind = 'VERIFY_REQUEST' | 'PROCUREMENT_DOCUMENT';

export type OperationDescriptor = {
  readonly permission: string;
  readonly purpose: PurposeRequirement;
  // null = any ACTIVE company type. Otherwise the tenant company must be ACTIVE and of one of these types.
  readonly companyTypes: readonly string[] | null;
  // Applies the Class D Partner gate (Active Partner + required agreements incl. Binding Confidentiality).
  readonly partnerClassD: boolean;
  // Every registered operation is resource-bound; the resource id is a route parameter owned by the server.
  // Only its presence and shape are validated here; ownership stays with the downstream authoritative boundary.
  readonly resource: { readonly kind: ResourceKind; readonly routeParam: string };
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
});

export function operationDescriptor(operation: unknown): OperationDescriptor | undefined {
  if (typeof operation !== 'string' || !Object.hasOwn(registry, operation)) return undefined;
  return registry[operation as AuthorizationOperation];
}
