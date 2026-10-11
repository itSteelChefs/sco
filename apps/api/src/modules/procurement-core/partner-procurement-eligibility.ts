/**
 * Abstract eligibility boundary for Procurement Core V1.
 * Composes A/B admission contracts via SQL (`partner_procurement_core_eligible`) —
 * does not re-implement Partner approval / agreement state machines.
 */
import { Inject, Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

export type PartnerProcurementEligibility = {
  eligible: boolean;
  boundary: 'partner_procurement_core_eligible';
};

@Injectable()
export class PartnerProcurementEligibilityService {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService) {}

  async evaluate(tenant: TenantContext): Promise<PartnerProcurementEligibility> {
    const result = await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) =>
      client.query<{ ok: boolean }>('SELECT public.partner_procurement_core_eligible($1,$2) AS ok', [
        tenant.userId,
        tenant.companyId,
      ]),
    );
    return { eligible: Boolean(result.rows[0]?.ok), boundary: 'partner_procurement_core_eligible' };
  }
}
