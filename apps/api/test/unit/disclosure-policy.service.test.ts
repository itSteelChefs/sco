import { describe, expect, it } from 'vitest';
import { DisclosurePolicyService } from '../../src/modules/disclosure/disclosure-policy.service.js';
import {
  EMBEDDED_IDENTITY_CLASSIFICATION,
  IDENTITY_CLASS,
  RECIPIENT_CONTEXT,
  type DisclosureRequest,
} from '../../src/modules/disclosure/disclosure.types.js';

const request = (overrides: Partial<DisclosureRequest> = {}): DisclosureRequest => ({
  actorUserId: 'actor',
  ownerCompanyId: 'owner',
  recipientCompanyId: 'recipient',
  resourceType: 'DISCLOSURE_FIXTURE',
  resourceId: 'resource',
  identityClass: IDENTITY_CLASS.PROJECT_SITE,
  recipientContext: RECIPIENT_CONTEXT.PARTNER,
  operation: 'PRESENT_ALIAS',
  embeddedIdentityClassification: EMBEDDED_IDENTITY_CLASSIFICATION.NONE,
  ...overrides,
});

describe('DisclosurePolicyService', () => {
  const policy = new DisclosurePolicyService();

  it('permits only the frozen partner project/site alias path', () => {
    expect(policy.decide(request())).toMatchObject({
      appliedLevel: 'ALIAS',
      reasonCode: 'PARTNER_PROJECT_SITE_ALIAS',
      requiresAliasResolution: true,
    });
  });

  it('fails closed for malformed context and unsupported identity combinations', () => {
    for (const input of [
      request({ recipientContext: 'CLIENT_CONTEXT' as never }),
      request({ identityClass: IDENTITY_CLASS.SUPPLIER_SOURCE }),
    ]) {
      expect(policy.decide(input)).toMatchObject({ appliedLevel: 'HIDDEN', requiresAliasResolution: false });
    }
  });

  it('does not treat a client-manufactured REAL request as authorization', () => {
    const decision = policy.decide({ ...request(), requestedDisclosureLevel: 'REAL' } as DisclosureRequest);
    expect(decision.appliedLevel).toBe('ALIAS');
    expect(decision).not.toHaveProperty('requestedDisclosureLevel');
  });

  it('keeps REAL inactive when an operation requests it without a server-issued authority', () => {
    expect(policy.decide(request({ operation: 'PRESENT_REAL' }))).toMatchObject({
      appliedLevel: 'HIDDEN',
      reasonCode: 'DISCLOSURE_POLICY_UNSUPPORTED',
      requiresAliasResolution: false,
    });
  });

  it('hides uncontrolled embedded identity instead of claiming redaction', () => {
    expect(policy.decide(request({
      embeddedIdentityClassification: EMBEDDED_IDENTITY_CLASSIFICATION.CLASSIFIED_KNOWN_RISK,
    }))).toMatchObject({ appliedLevel: 'HIDDEN', reasonCode: 'EMBEDDED_IDENTITY_RISK_UNCONTROLLED' });
  });

  it('keeps minimized inactive without an exact approved projection allowlist', () => {
    expect(policy.decide(request({
      recipientContext: RECIPIENT_CONTEXT.SAME_COMPANY_INTERNAL,
      operation: 'PRESENT_MINIMIZED',
    }))).toMatchObject({ appliedLevel: 'HIDDEN', requiresAliasResolution: false });
  });
});
