import { Body, Controller, Delete, Get, Inject, Param, Patch, UseGuards } from '@nestjs/common';
import { notFound } from '../../common/http/api-error.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';

type UpdateProbeBody = { label?: unknown };

@Controller('/api/v1/tenant-probes')
@UseGuards(AuthGuard, TenantGuard)
export class TenantProbesController {
  constructor(@Inject(TenantTransactionService) private readonly tenantTransactions: TenantTransactionService) {}

  @Get(':id')
  async get(@Param('id') id: string, @Tenant() tenant: TenantContext) {
    const result = await this.tenantTransactions.withTenant(tenant.userId, tenant.companyId, (client) =>
      client.query('SELECT id, company_id AS "companyId", label FROM tenant_probes WHERE id = $1', [id]),
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateProbeBody, @Tenant() tenant: TenantContext) {
    if (typeof body.label !== 'string') throw notFound();
    const result = await this.tenantTransactions.withTenant(tenant.userId, tenant.companyId, (client) =>
      client.query('UPDATE tenant_probes SET label = $2 WHERE id = $1 RETURNING id, label', [id, body.label]),
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Tenant() tenant: TenantContext) {
    const result = await this.tenantTransactions.withTenant(tenant.userId, tenant.companyId, (client) =>
      client.query('DELETE FROM tenant_probes WHERE id = $1 RETURNING id', [id]),
    );
    if (!result.rows[0]) throw notFound();
    return { ok: true };
  }
}
