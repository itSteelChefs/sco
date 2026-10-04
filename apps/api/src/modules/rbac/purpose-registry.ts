export const PURPOSE = {
  IDENTITY: 'PUR-01',
  AUTHORIZATION: 'PUR-02',
  PARTNER_RELATIONSHIP: 'PUR-03',
  PROJECT_CONTEXT: 'PUR-04',
  PROCUREMENT_NEED_INTAKE: 'PUR-05',
  PROCUREMENT_OPERATIONS: 'PUR-06',
  BUY_SIDE_SOURCING: 'PUR-07',
  SUPPLY_NETWORK: 'PUR-08',
  CATALOG: 'PUR-09',
  COMMERCIAL_PRICING: 'PUR-10',
  COMMERCIAL_OFFER: 'PUR-11',
  COMMERCIAL_COMMITMENT: 'PUR-12',
  DELIVERY: 'PUR-13',
  VERIFY: 'PUR-14',
  DOCUMENT_CUSTODY: 'PUR-15',
  AUDIT: 'PUR-16',
  PROCUREMENT_INTELLIGENCE: 'PUR-17',
  STUDIES: 'PUR-18',
} as const;

export type PurposeCode = (typeof PURPOSE)[keyof typeof PURPOSE];
export type PurposeFlowStatus = 'ALLOWED' | 'DENIED_BY_DEFAULT' | 'OWNER_DECISION_REQUIRED' | 'NOT_IMPLEMENTED';

export type PurposeOnlyRequirement = {
  kind: 'PURPOSE_ONLY';
  purpose: PurposeCode;
};

export type CrossPurposeFlowRequirement = {
  kind: 'CROSS_PURPOSE_FLOW';
  purpose: PurposeCode;
  flow: PurposeFlow;
};

export type PurposeRequirement = PurposeOnlyRequirement | CrossPurposeFlowRequirement;

const purposeCodes = new Set<string>(Object.values(PURPOSE));

export type PurposeFlowId = `CPF_${number}`;
export type PurposeFlow = {
  id: PurposeFlowId;
  source: PurposeCode;
  target: PurposeCode;
  status: PurposeFlowStatus;
};

const flow = (id: PurposeFlowId, source: PurposeCode, target: PurposeCode, status: PurposeFlowStatus): PurposeFlow => ({ id, source, target, status });

export const PURPOSE_FLOW = {
  CPF_01: flow('CPF_01', PURPOSE.IDENTITY, PURPOSE.IDENTITY, 'ALLOWED'), CPF_02: flow('CPF_02', PURPOSE.AUTHORIZATION, PURPOSE.AUTHORIZATION, 'ALLOWED'),
  CPF_03: flow('CPF_03', PURPOSE.PARTNER_RELATIONSHIP, PURPOSE.PROCUREMENT_NEED_INTAKE, 'ALLOWED'), CPF_04: flow('CPF_04', PURPOSE.PARTNER_RELATIONSHIP, PURPOSE.SUPPLY_NETWORK, 'ALLOWED'),
  CPF_05: flow('CPF_05', PURPOSE.PROJECT_CONTEXT, PURPOSE.PROCUREMENT_NEED_INTAKE, 'ALLOWED'), CPF_06: flow('CPF_06', PURPOSE.PROCUREMENT_NEED_INTAKE, PURPOSE.PROCUREMENT_OPERATIONS, 'ALLOWED'),
  CPF_07: flow('CPF_07', PURPOSE.PROCUREMENT_OPERATIONS, PURPOSE.BUY_SIDE_SOURCING, 'ALLOWED'), CPF_08: flow('CPF_08', PURPOSE.SUPPLY_NETWORK, PURPOSE.BUY_SIDE_SOURCING, 'ALLOWED'),
  CPF_09: flow('CPF_09', PURPOSE.BUY_SIDE_SOURCING, PURPOSE.COMMERCIAL_PRICING, 'ALLOWED'), CPF_10: flow('CPF_10', PURPOSE.COMMERCIAL_PRICING, PURPOSE.COMMERCIAL_OFFER, 'ALLOWED'),
  CPF_11: flow('CPF_11', PURPOSE.COMMERCIAL_OFFER, PURPOSE.COMMERCIAL_OFFER, 'ALLOWED'), CPF_12: flow('CPF_12', PURPOSE.COMMERCIAL_OFFER, PURPOSE.COMMERCIAL_COMMITMENT, 'ALLOWED'),
  CPF_13: flow('CPF_13', PURPOSE.PROCUREMENT_OPERATIONS, PURPOSE.DELIVERY, 'ALLOWED'), CPF_14: flow('CPF_14', PURPOSE.COMMERCIAL_COMMITMENT, PURPOSE.DELIVERY, 'ALLOWED'),
  CPF_15: flow('CPF_15', PURPOSE.DELIVERY, PURPOSE.DELIVERY, 'ALLOWED'), CPF_16: flow('CPF_16', PURPOSE.COMMERCIAL_COMMITMENT, PURPOSE.COMMERCIAL_COMMITMENT, 'ALLOWED'),
  CPF_17: flow('CPF_17', PURPOSE.CATALOG, PURPOSE.CATALOG, 'ALLOWED'), CPF_18: flow('CPF_18', PURPOSE.DOCUMENT_CUSTODY, PURPOSE.PROCUREMENT_NEED_INTAKE, 'ALLOWED'),
  CPF_19: flow('CPF_19', PURPOSE.DOCUMENT_CUSTODY, PURPOSE.BUY_SIDE_SOURCING, 'ALLOWED'), CPF_20: flow('CPF_20', PURPOSE.DOCUMENT_CUSTODY, PURPOSE.VERIFY, 'ALLOWED'),
  CPF_21: flow('CPF_21', PURPOSE.DOCUMENT_CUSTODY, PURPOSE.STUDIES, 'NOT_IMPLEMENTED'), CPF_22: flow('CPF_22', PURPOSE.VERIFY, PURPOSE.VERIFY, 'ALLOWED'),
  CPF_23: flow('CPF_23', PURPOSE.VERIFY, PURPOSE.PROCUREMENT_OPERATIONS, 'DENIED_BY_DEFAULT'), CPF_24: flow('CPF_24', PURPOSE.VERIFY, PURPOSE.COMMERCIAL_PRICING, 'DENIED_BY_DEFAULT'),
  CPF_25: flow('CPF_25', PURPOSE.VERIFY, PURPOSE.COMMERCIAL_OFFER, 'DENIED_BY_DEFAULT'), CPF_26: flow('CPF_26', PURPOSE.VERIFY, PURPOSE.PROCUREMENT_INTELLIGENCE, 'DENIED_BY_DEFAULT'),
  CPF_27: flow('CPF_27', PURPOSE.VERIFY, PURPOSE.SUPPLY_NETWORK, 'DENIED_BY_DEFAULT'), CPF_28: flow('CPF_28', PURPOSE.VERIFY, PURPOSE.VERIFY, 'DENIED_BY_DEFAULT'),
  CPF_29: flow('CPF_29', PURPOSE.BUY_SIDE_SOURCING, PURPOSE.COMMERCIAL_OFFER, 'DENIED_BY_DEFAULT'), CPF_30: flow('CPF_30', PURPOSE.SUPPLY_NETWORK, PURPOSE.COMMERCIAL_OFFER, 'DENIED_BY_DEFAULT'),
  CPF_31: flow('CPF_31', PURPOSE.PROJECT_CONTEXT, PURPOSE.SUPPLY_NETWORK, 'DENIED_BY_DEFAULT'), CPF_32: flow('CPF_32', PURPOSE.AUDIT, PURPOSE.COMMERCIAL_PRICING, 'DENIED_BY_DEFAULT'),
  CPF_33: flow('CPF_33', PURPOSE.PROCUREMENT_OPERATIONS, PURPOSE.PROCUREMENT_INTELLIGENCE, 'ALLOWED'), CPF_34: flow('CPF_34', PURPOSE.PROCUREMENT_OPERATIONS, PURPOSE.PROCUREMENT_INTELLIGENCE, 'OWNER_DECISION_REQUIRED'),
  CPF_35: flow('CPF_35', PURPOSE.BUY_SIDE_SOURCING, PURPOSE.PROCUREMENT_INTELLIGENCE, 'OWNER_DECISION_REQUIRED'), CPF_36: flow('CPF_36', PURPOSE.PROJECT_CONTEXT, PURPOSE.PROCUREMENT_INTELLIGENCE, 'OWNER_DECISION_REQUIRED'),
  CPF_37: flow('CPF_37', PURPOSE.PROCUREMENT_INTELLIGENCE, PURPOSE.BUY_SIDE_SOURCING, 'OWNER_DECISION_REQUIRED'), CPF_38: flow('CPF_38', PURPOSE.PROCUREMENT_INTELLIGENCE, PURPOSE.COMMERCIAL_PRICING, 'OWNER_DECISION_REQUIRED'),
  CPF_39: flow('CPF_39', PURPOSE.STUDIES, PURPOSE.PROCUREMENT_NEED_INTAKE, 'NOT_IMPLEMENTED'), CPF_40: flow('CPF_40', PURPOSE.STUDIES, PURPOSE.PROCUREMENT_INTELLIGENCE, 'NOT_IMPLEMENTED'),
  CPF_41: flow('CPF_41', PURPOSE.AUDIT, PURPOSE.AUDIT, 'ALLOWED'),
} as const;

export const PURPOSE_REQUIREMENT = {
  AUTHORIZATION: { kind: 'PURPOSE_ONLY', purpose: PURPOSE.AUTHORIZATION },
  DOCUMENT_CUSTODY: { kind: 'PURPOSE_ONLY', purpose: PURPOSE.DOCUMENT_CUSTODY },
  VERIFY: { kind: 'PURPOSE_ONLY', purpose: PURPOSE.VERIFY },
  PROCUREMENT_NEED_INTAKE: {
    kind: 'CROSS_PURPOSE_FLOW',
    purpose: PURPOSE.PROCUREMENT_NEED_INTAKE,
    flow: PURPOSE_FLOW.CPF_03,
  },
  PROCUREMENT_INTELLIGENCE: {
    kind: 'CROSS_PURPOSE_FLOW',
    purpose: PURPOSE.PROCUREMENT_INTELLIGENCE,
    flow: PURPOSE_FLOW.CPF_33,
  },
} as const satisfies Record<string, PurposeRequirement>;

export function isPurposeRequirement(value: unknown): value is PurposeRequirement {
  if (!value || typeof value !== 'object') return false;
  const requirement = value as { kind?: unknown; purpose?: unknown; flow?: { id?: unknown; source?: unknown; target?: unknown; status?: unknown } };
  if (typeof requirement.purpose !== 'string' || !purposeCodes.has(requirement.purpose)) return false;
  if (requirement.kind === 'PURPOSE_ONLY') return requirement.flow === undefined;
  if (requirement.kind !== 'CROSS_PURPOSE_FLOW' || !requirement.flow) return false;
  return typeof requirement.flow.id === 'string'
    && typeof requirement.flow.source === 'string'
    && typeof requirement.flow.target === 'string' && typeof requirement.flow.status === 'string'
    && purposeCodes.has(requirement.flow.source)
    && purposeCodes.has(requirement.flow.target);
}

export function isAllowedPurposeFlow(requirement: PurposeRequirement): boolean {
  if (requirement.kind === 'PURPOSE_ONLY') return true;
  const flow = Object.values(PURPOSE_FLOW).find((entry) => entry.id === requirement.flow.id);
  return flow?.status === 'ALLOWED'
    && flow.source === requirement.flow.source
    && flow.target === requirement.flow.target
    && flow.status === requirement.flow.status
    && requirement.purpose === flow.target;
}