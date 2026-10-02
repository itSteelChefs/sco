export const PURPOSE = {
  AUTHORIZATION: 'PUR-02',
  VERIFY: 'PUR-14',
  DOCUMENT_CUSTODY: 'PUR-15',
  AUDIT: 'PUR-16',
} as const;

export type PurposeCode = (typeof PURPOSE)[keyof typeof PURPOSE];

export type PurposeRequirement = {
  purpose: PurposeCode;
  flow?: { source: PurposeCode; target: PurposeCode };
};

const purposeCodes = new Set<string>(Object.values(PURPOSE));

export function isPurposeRequirement(value: unknown): value is PurposeRequirement {
  if (!value || typeof value !== 'object') return false;
  const requirement = value as { purpose?: unknown; flow?: { source?: unknown; target?: unknown } };
  if (typeof requirement.purpose !== 'string' || !purposeCodes.has(requirement.purpose)) return false;
  if (!requirement.flow) return true;
  return typeof requirement.flow.source === 'string'
    && typeof requirement.flow.target === 'string'
    && purposeCodes.has(requirement.flow.source)
    && purposeCodes.has(requirement.flow.target);
}

export function isAllowedPurposeFlow(requirement: PurposeRequirement): boolean {
  if (!requirement.flow) return true;
  return requirement.flow.source === requirement.flow.target
    || requirement.flow.target === PURPOSE.AUDIT;
}