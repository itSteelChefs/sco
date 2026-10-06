import { describe, expect, it } from 'vitest';
import { isAgreementAcceptanceLifecycleEligible } from '../src/modules/partner-journey/agreement-actionability.js';

describe('agreement acceptance lifecycle actionability', () => {
  it.each([
    ['UNDER_REVIEW', 'APPROVED', true],
    ['APPROVED', 'APPROVED', true],
    ['ACTIVE', 'APPROVED', true],
    ['SUSPENDED', 'APPROVED', false],
    ['REVOKED', 'APPROVED', false],
    ['UNDER_REVIEW', 'UNDER_REVIEW', false],
  ] as const)('is %s/%s => %s', (partnership, qualification, expected) => {
    expect(isAgreementAcceptanceLifecycleEligible(partnership, qualification)).toBe(expected);
  });
});
