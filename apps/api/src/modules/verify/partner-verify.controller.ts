import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { PartnerCompanyGuard } from '../../common/tenant/partner-company.guard.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PartnerVerifyService } from './partner-verify.service.js';

@Controller('/api/v1/partner/verify')
@UseGuards(AuthGuard, TenantGuard, PartnerCompanyGuard, PermissionGuard)
export class PartnerVerifyController {
  constructor(@Inject(PartnerVerifyService) private readonly partnerVerify: PartnerVerifyService) {}

  @Get('requests/:requestId/result')
  @RequirePermission('partner_verify.read')
  getResult(@Tenant() tenant: TenantContext, @Param('requestId') requestId: string) {
    return this.partnerVerify.getResult(tenant, requestId);
  }
}
