/** Stable vocabulary for Stage 003 ownership and confidentiality boundaries. */
export const DOMAIN_OWNERSHIPS = ['SYSTEM', 'PRE_TENANT', 'GLOBAL', 'TENANT', 'SCO_INTERNAL'] as const;
export type DomainOwnership = (typeof DOMAIN_OWNERSHIPS)[number];

export const CONFIDENTIALITY_CLASSES = [
  'PUBLIC_PRODUCT',
  'TENANT_CONFIDENTIAL',
  'SCO_COMMERCIAL_CONFIDENTIAL',
  'SCO_HIGHLY_RESTRICTED',
] as const;
export type ConfidentialityClass = (typeof CONFIDENTIALITY_CLASSES)[number];

export const PARTNERSHIP_TYPES = ['BUYER_PARTNERSHIP', 'SUPPLIER_PARTNERSHIP'] as const;
export type PartnershipType = (typeof PARTNERSHIP_TYPES)[number];

export type RelationshipBoundary =
  | 'PARTNER'
  | 'SUPPLIER_COMPANY'
  | 'PURCHASE_SOURCE'
  | 'SCO_INTERNAL_SCOPE';

export const QUALIFICATION_STATES = ['APPLICATION', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED'] as const;
export type QualificationState = (typeof QUALIFICATION_STATES)[number];

export const DEMAND_MATURITY_STATES = ['FORECAST', 'PLANNED', 'APPROVED', 'READY'] as const;
export type DemandMaturity = (typeof DEMAND_MATURITY_STATES)[number];

export const COMMITMENT_STATES = ['READY', 'SCO_OFFER', 'ACCEPTED', 'PARTNER_PO_ISSUED', 'COMMITTED'] as const;
export type CommitmentState = (typeof COMMITMENT_STATES)[number];

export const FUNDING_STATES = ['AWAITING_PAYMENT', 'FUNDED', 'PROCUREMENT_RELEASED'] as const;
export type FundingState = (typeof FUNDING_STATES)[number];

export const DELIVERY_STATES = ['SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'RECEIVED', 'ACCEPTED', 'DELIVERY_ISSUE', 'CLOSED'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const APPROVAL_STATES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export type AggregationAccessContract = {
  purpose: 'SCO_INTERNAL_AGGREGATION';
  rawCrossTenantAccess: false;
  genericRlsBypass: false;
  output: 'AUTHORIZED_AGGREGATE_PROJECTION';
};

export const SCO_AGGREGATION_ACCESS: AggregationAccessContract = {
  purpose: 'SCO_INTERNAL_AGGREGATION',
  rawCrossTenantAccess: false,
  genericRlsBypass: false,
  output: 'AUTHORIZED_AGGREGATE_PROJECTION',
};

export type VisibilityAudience = 'SCO_OWNER_ADMIN' | 'SCO_AUTHORIZED_EMPLOYEE' | 'BUYER_ADMIN_USER' | 'SUPPLIER_ADMIN_USER';

export type FieldVisibilityContract = {
  classification: ConfidentialityClass;
  audiences: readonly VisibilityAudience[];
};

export const FIELD_VISIBILITY_CONTRACTS = {
  productIdentity: { classification: 'PUBLIC_PRODUCT', audiences: ['SCO_OWNER_ADMIN', 'SCO_AUTHORIZED_EMPLOYEE', 'BUYER_ADMIN_USER', 'SUPPLIER_ADMIN_USER'] },
  purchaseSource: { classification: 'SCO_COMMERCIAL_CONFIDENTIAL', audiences: ['SCO_OWNER_ADMIN', 'SCO_AUTHORIZED_EMPLOYEE'] },
  purchaseCost: { classification: 'SCO_COMMERCIAL_CONFIDENTIAL', audiences: ['SCO_OWNER_ADMIN', 'SCO_AUTHORIZED_EMPLOYEE'] },
  margin: { classification: 'SCO_HIGHLY_RESTRICTED', audiences: ['SCO_OWNER_ADMIN'] },
  buyerContribution: { classification: 'SCO_COMMERCIAL_CONFIDENTIAL', audiences: ['SCO_OWNER_ADMIN', 'SCO_AUTHORIZED_EMPLOYEE'] },
} as const satisfies Record<string, FieldVisibilityContract>;
