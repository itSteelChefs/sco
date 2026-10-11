import { Controller, Get, Inject, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { PurposeGuard } from '../rbac/purpose.guard.js';
import { PURPOSE_REQUIREMENT } from '../rbac/purpose-registry.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { RequirePurpose } from '../rbac/require-purpose.decorator.js';
import { PartnerBuyResellService } from './partner-buy-resell.service.js';

@Controller('/api/v1/partner/commercial/orders')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard, PurposeGuard)
export class PartnerBuyResellController {
  constructor(@Inject(PartnerBuyResellService) private readonly commercial: PartnerBuyResellService) {}

  @Get()
  @RequirePermission('commercial.order.partner_read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  list(@Tenant() tenant: TenantContext) {
    return this.commercial.list(tenant.userId, tenant.companyId);
  }

  @Get(':id')
  @RequirePermission('commercial.order.partner_read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.get(tenant.userId, tenant.companyId, id);
  }
}
