import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { PartnerCompanyGuard } from '../../common/tenant/partner-company.guard.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { PurposeGuard } from '../rbac/purpose.guard.js';
import { PURPOSE } from '../rbac/purpose-registry.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { RequirePurpose } from '../rbac/require-purpose.decorator.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PartnerVerifyService } from './partner-verify.service.js';

@Controller('/api/v1/partner/verify')
@UseGuards(AuthGuard, TenantGuard, PartnerCompanyGuard, PermissionGuard, PurposeGuard)
export class PartnerVerifyController {
  constructor(@Inject(PartnerVerifyService) private readonly partnerVerify: PartnerVerifyService) {}

  @Get('requests/:requestId/result')
  @RequirePermission('partner_verify.read')
  @RequirePurpose({ purpose: PURPOSE.VERIFY })
  getResult(@Tenant() tenant: TenantContext, @Param('requestId') requestId: string) {
    return this.partnerVerify.getResult(tenant, requestId);
  }
}
