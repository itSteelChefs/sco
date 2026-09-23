import { describe, expect, it } from 'vitest';
import {
  CONFIDENTIALITY_CLASSES,
  DOMAIN_OWNERSHIPS,
  FIELD_VISIBILITY_CONTRACTS,
  SCO_AGGREGATION_ACCESS,
  PARTNERSHIP_TYPES,
  DEMAND_MATURITY_STATES,
  COMMITMENT_STATES,
  FUNDING_STATES,
  DELIVERY_STATES,
  APPROVAL_STATES,
} from '../../src/common/contracts/stage-003-contracts.js';

describe('Stage 003 architecture contracts', () => {
  it('defines the approved ownership and confidentiality vocabularies', () => {
    expect(DOMAIN_OWNERSHIPS).toEqual(['SYSTEM', 'PRE_TENANT', 'GLOBAL', 'TENANT', 'SCO_INTERNAL']);
    expect(CONFIDENTIALITY_CLASSES).toEqual([
      'PUBLIC_PRODUCT', 'TENANT_CONFIDENTIAL', 'SCO_COMMERCIAL_CONFIDENTIAL', 'SCO_HIGHLY_RESTRICTED',
    ]);
    expect(PARTNERSHIP_TYPES).toEqual(['BUYER_PARTNERSHIP', 'SUPPLIER_PARTNERSHIP']);
  });

  it('prohibits unrestricted cross-tenant aggregation access', () => {
    expect(SCO_AGGREGATION_ACCESS).toEqual({
      purpose: 'SCO_INTERNAL_AGGREGATION',
      rawCrossTenantAccess: false,
      genericRlsBypass: false,
      output: 'AUTHORIZED_AGGREGATE_PROJECTION',
    });
    expect(FIELD_VISIBILITY_CONTRACTS.purchaseCost.audiences).not.toContain('BUYER_ADMIN_USER');
    expect(FIELD_VISIBILITY_CONTRACTS.margin.audiences).toEqual(['SCO_OWNER_ADMIN']);
  });

  it('defines state vocabulary without inventing probability weights', () => {
    expect(DEMAND_MATURITY_STATES).toEqual(['FORECAST', 'PLANNED', 'APPROVED', 'READY']);
    expect(COMMITMENT_STATES).toContain('PARTNER_PO_ISSUED');
    expect(FUNDING_STATES).toEqual(['AWAITING_PAYMENT', 'FUNDED', 'PROCUREMENT_RELEASED']);
    expect(DELIVERY_STATES).toContain('DELIVERY_ISSUE');
    expect(APPROVAL_STATES).toEqual(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED']);
  });
});
