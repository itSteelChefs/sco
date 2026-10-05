// Safe, Partner-facing projection of the existing server-authoritative lifecycle. Every field is derived per request
// from existing facts (qualification, partnership, agreement acceptance, RBAC, Class D eligibility); none is stored,
// cached or accepted from the caller. It carries no agreement content, hashes, permission codes, policy internals,
// supplier identity, commercial facts, storage details or other tenants' data.

export type JourneyStage =
  | 'REGISTRATION'
  | 'QUALIFICATION'
  | 'AGREEMENT'
  | 'APPROVAL'
  | 'ONBOARDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REVOKED'
  | 'REJECTED';

export type QualificationState = 'NONE' | 'APPLICATION' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
export type PartnershipState = 'NONE' | 'UNDER_REVIEW' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'REJECTED';

export type JourneyNextActionCode = 'ACCEPT_AGREEMENTS' | 'AWAIT_SCO_REVIEW' | 'CONTACT_SCO' | 'NONE';

export type UnavailableReason =
  | 'PERMISSION_REQUIRED'
  | 'RELATIONSHIP_NOT_ACTIVE'
  | 'AGREEMENT_REQUIRED'
  | 'NOT_AVAILABLE';

export type JourneyRelationship = {
  stage: JourneyStage;
  qualification: QualificationState;
  partnership: PartnershipState;
  agreementsSatisfied: boolean;
  pendingAgreements: Array<{ agreementType: string; version: string; status: string; actionable: boolean }>;
};

// RELATIONSHIP status (relationship.partnership) is the commercial lifecycle fact owned by company_partnerships and is
// never changed by agreement state. OPERATIONAL procurement access is a separate, derived, per-request answer from the
// Class D gate: an ACTIVE relationship whose required agreement needs reacceptance stays ACTIVE and is RESTRICTED.
export type OperationalProcurementAccess = 'AVAILABLE' | 'RESTRICTED';

export type PartnerJourney = {
  company: { id: string; name: string };
  actor: { userId: string; membershipId: string };
  operational: { procurementAccess: OperationalProcurementAccess; reason?: UnavailableReason };
  // Null when the actor lacks partner.admission.read: relationship state is then not disclosed.
  relationship: JourneyRelationship | null;
  nextAction: { code: JourneyNextActionCode; owner: 'PARTNER' | 'SCO' | 'NONE'; permitted: boolean } | null;
  experiences: Array<{
    code: 'PARTNER_SHELL' | 'ONBOARDING' | 'PROCUREMENT';
    classification: 'C' | 'B' | 'D';
    enterable: boolean;
    reason?: UnavailableReason;
  }>;
  capabilities: Array<{
    code: 'AGREEMENT_ACCEPTANCE' | 'VERIFY_RESULT_READ' | 'PROCUREMENT_DOCUMENT_EXTRACTION';
    classification: 'B' | 'D';
    available: boolean;
    reason?: UnavailableReason;
  }>;
};
