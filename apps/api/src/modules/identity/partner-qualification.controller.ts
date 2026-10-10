import { Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { PurposeGuard } from '../rbac/purpose.guard.js';
import { PURPOSE_REQUIREMENT } from '../rbac/purpose-registry.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { RequirePurpose } from '../rbac/require-purpose.decorator.js';
import { PartnerQualificationDraftDto } from './partner-qualification.dto.js';
import { PartnerQualificationService } from './partner-qualification.service.js';

@Controller('/api/v1/partner/qualification')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard, PurposeGuard)
export class PartnerQualificationController {
  constructor(@Inject(PartnerQualificationService) private readonly qualifications: PartnerQualificationService) {}

  @Get('current')
  @RequirePermission('partner.admission.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  current(@Tenant() tenant: TenantContext) {
    return this.qualifications.getCurrent(tenant);
  }

  @Put('draft')
  @RequirePermission('partner.qualification.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  saveDraft(@Tenant() tenant: TenantContext, @Body() body: PartnerQualificationDraftDto) {
    return this.qualifications.saveDraft(tenant, body);
  }

  @Post('draft')
  @RequirePermission('partner.qualification.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  createDraft(@Tenant() tenant: TenantContext, @Body() body: PartnerQualificationDraftDto) {
    return this.qualifications.saveDraft(tenant, body);
  }

  @Post('submit')
  @RequirePermission('partner.qualification.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  submit(@Tenant() tenant: TenantContext) {
    return this.qualifications.submit(tenant);
  }
}
