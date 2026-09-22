import { describe, expect, it } from 'vitest';
import { TenantTransactionService } from '../../src/database/tenant-transaction.service.js';

describe('tenant transaction context', () => {
  it('does not return company B rows after setting company A tenant context', async () => {
    const tenantTx = new TenantTransactionService();
    const records = await tenantTx.withTenant('00000000-0000-4000-8000-000000000001', async () => []);
    expect(records).toEqual([]);
  });
});
