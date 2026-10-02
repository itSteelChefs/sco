import { describe, expect, it, vi } from 'vitest';
import { PlanningService } from '../../src/modules/identity/planning.service.js';

const context = {
  membershipId: 'membership',
  userId: 'actor',
  companyId: 'company',
  status: 'ACTIVE' as const,
};

const input = {
  description: 'Need',
  quantity: 1,
  needDate: '2026-10-02',
};

describe('PlanningService', () => {
  it('uses the fixed CPF-03 gateway rather than exposing direct runtime writes', async () => {
    const tenants = { withTenant: vi.fn() };
    const internal = { createProcurementNeed: vi.fn().mockResolvedValue({ id: 'need' }) };
    const service = new PlanningService(tenants as never, internal as never);

    await expect(service.createNeed(context, input)).resolves.toEqual({ id: 'need' });
    expect(internal.createProcurementNeed).toHaveBeenCalledWith('actor', 'company', input, expect.any(String));
    expect((internal.createProcurementNeed.mock.calls[0][3] as string)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(tenants.withTenant).not.toHaveBeenCalled();
  });
});
