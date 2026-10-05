import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { AUTHORIZATION_OPERATION } from '../authorization/authorization-operations.js';
import { AuthorizeOperation } from '../authorization/require-authorization.decorator.js';
import { ResourceAuthorizationGuard } from '../authorization/resource-authorization.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PartnerVerifyService } from './partner-verify.service.js';

@Controller('/api/v1/partner/verify')
@UseGuards(AuthGuard, TenantGuard, ResourceAuthorizationGuard)
export class PartnerVerifyController {
  constructor(@Inject(PartnerVerifyService) private readonly partnerVerify: PartnerVerifyService) {}

  @Get('requests/:requestId/result')
  @AuthorizeOperation(AUTHORIZATION_OPERATION.PARTNER_VERIFY_RESULT_READ)
  getResult(@Tenant() tenant: TenantContext, @Param('requestId') requestId: string) {
    return this.partnerVerify.getResult(tenant, requestId);
  }
}
