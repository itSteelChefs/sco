const ELIGIBLE_PARTNERSHIPS = new Set(['UNDER_REVIEW', 'APPROVED', 'ACTIVE']);

export function isAgreementAcceptanceLifecycleEligible(partnershipStatus: string | null, qualificationStatus: string | null): boolean {
  return qualificationStatus === 'APPROVED' && partnershipStatus !== null && ELIGIBLE_PARTNERSHIPS.has(partnershipStatus);
}
