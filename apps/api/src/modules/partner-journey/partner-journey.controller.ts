import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { AUTHORIZATION_OPERATION } from '../authorization/authorization-operations.js';
import { AuthorizeOperation } from '../authorization/require-authorization.decorator.js';
import { ResourceAuthorizationGuard } from '../authorization/resource-authorization.guard.js';
import { PartnerJourneyService } from './partner-journey.service.js';

@Controller('/api/v1/partner/journey')
@UseGuards(AuthGuard, TenantGuard, ResourceAuthorizationGuard)
export class PartnerJourneyController {
  constructor(@Inject(PartnerJourneyService) private readonly journey: PartnerJourneyService) {}

  @Get()
  @AuthorizeOperation(AUTHORIZATION_OPERATION.PARTNER_JOURNEY_READ)
  get(@Tenant() tenant: TenantContext) {
    return this.journey.get(tenant);
  }
}
