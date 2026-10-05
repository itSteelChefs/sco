import { Inject, Injectable } from '@nestjs/common';
import { forbidden } from '../../common/http/api-error.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';

@Injectable()
export class PartnerProcurementAccessService {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService) {}

  async allowed(tenant: TenantContext): Promise<boolean> {
    return this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
      const result = await client.query<{ allowed: boolean }>(
        'SELECT public.partner_procurement_access_allowed_for_current_actor() AS allowed',
      );
      return result.rows[0]?.allowed === true;
    });
  }

  async require(tenant: TenantContext): Promise<void> {
    if (!(await this.allowed(tenant))) throw forbidden();
  }
}
