export const DISCLOSURE_LEVEL = {
  REAL: 'REAL',
  MINIMIZED: 'MINIMIZED',
  ALIAS: 'ALIAS',
  HIDDEN: 'HIDDEN',
} as const;

export type DisclosureLevel = (typeof DISCLOSURE_LEVEL)[keyof typeof DISCLOSURE_LEVEL];

export const IDENTITY_CLASS = {
  ORGANIZATION: 'ORGANIZATION',
  SUPPLIER_SOURCE: 'SUPPLIER_SOURCE',
  PERSON_CONTACT: 'PERSON_CONTACT',
  PROJECT_SITE: 'PROJECT_SITE',
  EMBEDDED_IDENTITY_RISK: 'EMBEDDED_IDENTITY_RISK',
} as const;

export type IdentityClass = (typeof IDENTITY_CLASS)[keyof typeof IDENTITY_CLASS];

export const RECIPIENT_CONTEXT = {
  SAME_COMPANY_INTERNAL: 'SAME_COMPANY_INTERNAL',
  PARTNER: 'PARTNER',
  SCO_INTERNAL: 'SCO_INTERNAL',
  CROSS_PARTY_EXTERNAL: 'CROSS_PARTY_EXTERNAL',
} as const;

export type RecipientContext = (typeof RECIPIENT_CONTEXT)[keyof typeof RECIPIENT_CONTEXT];

export const ALIAS_LIFECYCLE_STATUS = {
  ACTIVE: 'ACTIVE',
  RETIRED: 'RETIRED',
} as const;

export type AliasLifecycleStatus = (typeof ALIAS_LIFECYCLE_STATUS)[keyof typeof ALIAS_LIFECYCLE_STATUS];

export const EMBEDDED_IDENTITY_CLASSIFICATION = {
  NONE: 'NONE',
  CLASSIFIED_KNOWN_RISK: 'CLASSIFIED_KNOWN_RISK',
} as const;

export type EmbeddedIdentityClassification = (typeof EMBEDDED_IDENTITY_CLASSIFICATION)[keyof typeof EMBEDDED_IDENTITY_CLASSIFICATION];

export type DisclosureResourceType = 'DISCLOSURE_FIXTURE';
export type DisclosureOperation = 'PRESENT_ALIAS' | 'PRESENT_MINIMIZED';

export type DisclosureRequest = {
  actorUserId: string;
  ownerCompanyId: string;
  recipientCompanyId: string;
  resourceType: DisclosureResourceType;
  resourceId: string;
  identityClass: IdentityClass;
  recipientContext: RecipientContext;
  operation: DisclosureOperation;
  embeddedIdentityClassification: EmbeddedIdentityClassification;
};

export type DisclosureDecision = {
  appliedLevel: DisclosureLevel;
  reasonCode: string;
  policyVersion: '008-A';
  requiresAliasResolution: boolean;
  auditContext: {
    identityClass: IdentityClass;
    recipientContext: RecipientContext;
    resourceType: DisclosureResourceType;
    resourceId: string;
    operation: DisclosureOperation;
  };
};
