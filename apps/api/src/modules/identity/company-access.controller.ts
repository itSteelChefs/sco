import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { forbidden, notFound } from '../../common/http/api-error.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { CompaniesService } from './companies.service.js';

@Controller('/api/v1/companies')
@UseGuards(AuthGuard, TenantGuard)
export class CompanyAccessController {
  constructor(
    @Inject(TenantTransactionService) private readonly tenantTransactions: TenantTransactionService,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
  ) {}

  @Get('current/me')
  async current(@Tenant() tenant: TenantContext) {
    const company = await this.tenantTransactions.withTenant(tenant.userId, tenant.companyId, (client) =>
      this.companies.findProjection(client, tenant.companyId),
    );
    if (!company) throw notFound();
    return company;
  }

  @Get(':companyId/me')
  async byId(@Param('companyId') companyId: string, @Tenant() tenant: TenantContext) {
    if (companyId !== tenant.companyId) throw forbidden();
    return this.current(tenant);
  }
}
