import { describe, expect, it } from 'vitest';
import { PurposeAuthorizationService } from '../../src/modules/rbac/purpose-authorization.service.js';
import { PURPOSE, PURPOSE_FLOW, PURPOSE_REQUIREMENT } from '../../src/modules/rbac/purpose-registry.js';

const context = {
  membershipId: 'membership',
  userId: 'actor',
  companyId: 'company',
  status: 'ACTIVE' as const,
};

describe('PurposeAuthorizationService', () => {
  const purposes = new PurposeAuthorizationService();

  it('allows a declared contract purpose in an authenticated tenant context', () => {
    expect(purposes.allows(context, PURPOSE_REQUIREMENT.VERIFY)).toBe(true);
  });

  it('fails closed for a missing or unregistered purpose', () => {
    expect(purposes.allows(context, undefined)).toBe(false);
    expect(purposes.allows(context, { kind: 'PURPOSE_ONLY', purpose: 'client-supplied' })).toBe(false);
  });

  it('fails closed for a cross-purpose flow not explicitly permitted by the foundation', () => {
    expect(purposes.allows(context, {
      kind: 'CROSS_PURPOSE_FLOW',
      purpose: PURPOSE.VERIFY,
      flow: { id: 'CPF_99', source: PURPOSE.VERIFY, target: PURPOSE.DOCUMENT_CUSTODY, status: 'ALLOWED' },
    })).toBe(false);
  });

  it('allows only registered allowed flows from the complete CPF registry', () => {
    expect(purposes.allows(context, {
      kind: 'CROSS_PURPOSE_FLOW',
      purpose: PURPOSE.PROCUREMENT_NEED_INTAKE,
      flow: PURPOSE_FLOW.CPF_03,
    })).toBe(true);
    expect(purposes.allows(context, {
      kind: 'CROSS_PURPOSE_FLOW',
      purpose: PURPOSE.VERIFY,
      flow: PURPOSE_FLOW.CPF_23,
    })).toBe(false);
    expect(purposes.allows(context, {
      kind: 'CROSS_PURPOSE_FLOW',
      purpose: PURPOSE.PROCUREMENT_INTELLIGENCE,
      flow: PURPOSE_FLOW.CPF_37,
    })).toBe(false);
    expect(purposes.allows(context, {
      kind: 'CROSS_PURPOSE_FLOW',
      purpose: PURPOSE.VERIFY,
      flow: PURPOSE_FLOW.CPF_28,
    })).toBe(false);
  });

  it('never authorizes purpose metadata without a tenant context', () => {
    expect(purposes.allows(undefined, PURPOSE_REQUIREMENT.AUTHORIZATION)).toBe(false);
  });

  it('fails closed when a cross-purpose operation omits, substitutes, or mismatches its CPF', () => {
    expect(purposes.allows(context, { kind: 'CROSS_PURPOSE_FLOW', purpose: PURPOSE.PROCUREMENT_NEED_INTAKE })).toBe(false);
    expect(purposes.allows(context, {
      kind: 'CROSS_PURPOSE_FLOW',
      purpose: PURPOSE.VERIFY,
      flow: PURPOSE_FLOW.CPF_03,
    })).toBe(false);
    expect(purposes.allows(context, {
      kind: 'CROSS_PURPOSE_FLOW',
      purpose: PURPOSE.VERIFY,
      flow: { ...PURPOSE_FLOW.CPF_22, id: PURPOSE_FLOW.CPF_28.id },
    })).toBe(false);
  });
});