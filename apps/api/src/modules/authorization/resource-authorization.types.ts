import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { PurposeRequirement } from '../rbac/purpose-registry.js';

export type AuthorizationLayer =
  | 'CONTEXT'
  | 'OPERATION'
  | 'RESOURCE_CONTEXT'
  | 'MEMBERSHIP'
  | 'COMPANY'
  | 'PERMISSION'
  | 'PURPOSE'
  | 'PARTNER_ELIGIBILITY';

export type AuthorizationDenyReason =
  | 'ACTOR_CONTEXT_REQUIRED'
  | 'ACTOR_CONTEXT_MALFORMED'
  | 'OPERATION_UNKNOWN'
  | 'RESOURCE_CONTEXT_REQUIRED'
  | 'RESOURCE_CONTEXT_MALFORMED'
  | 'MEMBERSHIP_INACTIVE'
  | 'MEMBERSHIP_MISMATCH'
  | 'COMPANY_TYPE_INELIGIBLE'
  | 'PERMISSION_MISSING'
  | 'PURPOSE_MISMATCH'
  | 'PURPOSE_NOT_ALLOWED'
  | 'PARTNER_NOT_ELIGIBLE'
  | 'AUTHORIZATION_UNAVAILABLE';

// Facts here are server-resolved. Nothing in this request is trusted as an authorization claim by itself:
// every layer is re-derived from the database or the closed operation registry.
export type ResourceAuthorizationRequest = {
  tenant: TenantContext | undefined;
  operation: unknown;
  // Optional declaration by the call site. The registry owns the purpose; a differing declaration is denied.
  purpose?: PurposeRequirement;
  // Route-declared resource identity. Only presence and shape are validated by H1.
  resource?: { id?: unknown };
  correlationId?: string;
};

export type AuthorizationEvidence = {
  operation: string | null;
  purposeCode: string | null;
  resourceKind: string | null;
  evaluatedLayers: AuthorizationLayer[];
  failedLayer: AuthorizationLayer | null;
};

export type AuthorizationDecision =
  | { allowed: true; evidence: AuthorizationEvidence; purpose: PurposeRequirement }
  | { allowed: false; reason: AuthorizationDenyReason; evidence: AuthorizationEvidence };

// Advisory, non-enforcing answer to "would this actor currently be eligible for this operation?". It deliberately has
// no `allowed` field and a distinct `kind`, so it can never be passed where an enforcing AuthorizationDecision is
// required. Only decide()/require() (the H1 guard path) authorize anything.
export type AuthorizationAvailability = {
  readonly kind: 'ADVISORY_AVAILABILITY';
  readonly available: boolean;
  readonly reason?: AuthorizationDenyReason;
  readonly evidence: AuthorizationEvidence;
};
