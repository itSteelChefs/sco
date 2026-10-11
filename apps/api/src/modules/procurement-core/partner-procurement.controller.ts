import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { PurposeGuard } from '../rbac/purpose.guard.js';
import { PURPOSE_REQUIREMENT } from '../rbac/purpose-registry.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { RequirePurpose } from '../rbac/require-purpose.decorator.js';
import { PartnerProcurementLineDto, PartnerProcurementRequirementDraftDto } from './partner-procurement.dto.js';
import { PartnerProcurementService } from './partner-procurement.service.js';
import { PartnerProcurementEligibilityService } from './partner-procurement-eligibility.js';

@Controller('/api/v1/partner/procurement/requirements')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard, PurposeGuard)
export class PartnerProcurementController {
  constructor(
    @Inject(PartnerProcurementService) private readonly procurement: PartnerProcurementService,
    @Inject(PartnerProcurementEligibilityService) private readonly eligibility: PartnerProcurementEligibilityService,
  ) {}

  @Get('eligibility')
  @RequirePermission('procurement.request.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  eligibilityCheck(@Tenant() tenant: TenantContext) {
    return this.eligibility.evaluate(tenant);
  }

  @Get()
  @RequirePermission('procurement.request.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  list(@Tenant() tenant: TenantContext) {
    return this.procurement.list(tenant);
  }

  @Post()
  @RequirePermission('procurement.request.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  create(@Tenant() tenant: TenantContext, @Body() body: PartnerProcurementRequirementDraftDto) {
    return this.procurement.create(tenant, body);
  }

  @Get(':id')
  @RequirePermission('procurement.request.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.procurement.get(tenant, id);
  }

  @Put(':id')
  @RequirePermission('procurement.request.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  update(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: PartnerProcurementRequirementDraftDto) {
    return this.procurement.updateDraft(tenant, id, body);
  }

  @Post(':id/submit')
  @RequirePermission('procurement.request.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  submit(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.procurement.submit(tenant, id);
  }

  @Post(':id/lines')
  @RequirePermission('procurement.request.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  upsertLine(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PartnerProcurementLineDto,
  ) {
    return this.procurement.upsertLine(tenant, id, body);
  }

  @Get(':id/comparison')
  @RequirePermission('procurement.request.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  comparison(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.procurement.comparison(tenant, id);
  }
}
