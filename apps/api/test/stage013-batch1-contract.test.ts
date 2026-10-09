import { describe, expect, it } from 'vitest';
import { AUTHORIZATION_OPERATION, operationDescriptor } from '../src/modules/authorization/authorization-operations.js';
import { PURPOSE, PURPOSE_REQUIREMENT } from '../src/modules/rbac/purpose-registry.js';

describe('Stage 013 Batch 1 contract', () => {
  it('defines exactly one dedicated Collaboration Purpose and reuses it for all Batch 1 operations', () => {
    expect(PURPOSE.COLLABORATION).toBeDefined();
    expect(PURPOSE.COLLABORATION).not.toBe('COLLABORATION_REALTIME');

    const operations = [
      AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_LIST,
      AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_CREATE,
      AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_READ,
      AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_ARCHIVE,
      AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_PARTICIPATION_GRANT,
      AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_PARTICIPATION_REVOKE,
      AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_PARTICIPATION_JOIN,
      AUTHORIZATION_OPERATION.PARTNER_COLLABORATION_PARTICIPATION_LEAVE,
    ];

    for (const operation of operations) {
      expect(operationDescriptor(operation)?.purpose).toEqual(PURPOSE_REQUIREMENT.COLLABORATION);
    }
  });

  it('does not register Batch 2 execution or Presence operations', () => {
    const operations = Object.values(AUTHORIZATION_OPERATION).join('|');
    expect(operations).not.toMatch(/execution|presence|transport|provider/i);
  });
});
