export type PartnerMembershipProvisionInput = { targetUserId: string; targetCompanyId: string; operationKey: string };
export type PartnerMembershipProvisionResult = { operationId: string; membershipId: string; userId: string; companyId: string; membershipStatus: string; outcome: 'CREATED' | 'ALREADY_EXISTS' | 'REPLAYED' };
