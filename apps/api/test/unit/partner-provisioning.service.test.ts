import { describe, expect, it } from 'vitest';
import { PartnerProvisioningService } from '../../src/modules/partner-provisioning/partner-provisioning.service.js';

describe('PartnerProvisioningService', () => {
  it('delegates only existing UUID targets and an operation key', async () => {
    const calls: unknown[][] = [];
    const internal = { provisionPartnerMembership: async (...args: unknown[]) => { calls.push(args); return { operationId: 'op', membershipId: 'membership', userId: 'user', companyId: 'company', membershipStatus: 'ACTIVE', outcome: 'CREATED' as const }; } };
    const service = new PartnerProvisioningService(internal as never);
    await expect(service.provision('actor', { targetUserId: '00000000-0000-4000-8000-000000000001', targetCompanyId: '00000000-0000-4000-8000-000000000002', operationKey: 'stage016-test-key' })).resolves.toMatchObject({ outcome: 'CREATED' });
    expect(calls).toEqual([['actor', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'stage016-test-key']]);
  });

  it('rejects malformed input before reaching the database adapter', async () => {
    const internal = { provisionPartnerMembership: async () => { throw new Error('must not run'); } };
    const service = new PartnerProvisioningService(internal as never);
    await expect(service.provision('actor', { targetUserId: 'bad', targetCompanyId: '00000000-0000-4000-8000-000000000002', operationKey: '' })).rejects.toMatchObject({ response: { error: { code: 'PARTNER_PROVISIONING_INPUT_INVALID' } } });
  });
});
