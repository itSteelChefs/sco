import { describe, expect, it } from 'vitest';
import { PurposeAuthorizationService } from '../../src/modules/rbac/purpose-authorization.service.js';
import { PURPOSE } from '../../src/modules/rbac/purpose-registry.js';

const context = {
  membershipId: 'membership',
  userId: 'actor',
  companyId: 'company',
  status: 'ACTIVE' as const,
};

describe('PurposeAuthorizationService', () => {
  const purposes = new PurposeAuthorizationService();

  it('allows a declared contract purpose in an authenticated tenant context', () => {
    expect(purposes.allows(context, { purpose: PURPOSE.VERIFY })).toBe(true);
  });

  it('fails closed for a missing or unregistered purpose', () => {
    expect(purposes.allows(context, undefined)).toBe(false);
    expect(purposes.allows(context, { purpose: 'client-supplied' })).toBe(false);
  });

  it('fails closed for a cross-purpose flow not explicitly permitted by the foundation', () => {
    expect(purposes.allows(context, {
      purpose: PURPOSE.VERIFY,
      flow: { source: PURPOSE.VERIFY, target: PURPOSE.DOCUMENT_CUSTODY },
    })).toBe(false);
  });

  it('never authorizes purpose metadata without a tenant context', () => {
    expect(purposes.allows(undefined, { purpose: PURPOSE.AUTHORIZATION })).toBe(false);
  });
});