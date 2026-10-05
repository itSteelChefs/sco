import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { PurposeGuard } from '../rbac/purpose.guard.js';
import { PURPOSE_REQUIREMENT } from '../rbac/purpose-registry.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { RequirePurpose } from '../rbac/require-purpose.decorator.js';
import { PartnerAgreementAcceptanceDto } from './partner-admission.dto.js';
import { PartnerAdmissionService } from './partner-admission.service.js';

@Controller('/api/v1/partner/admission')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard, PurposeGuard)
export class PartnerAdmissionController {
  constructor(@Inject(PartnerAdmissionService) private readonly admission: PartnerAdmissionService) {}

  @Get('status')
  @RequirePermission('partner.admission.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  status(@Tenant() tenant: TenantContext) {
    return this.admission.status(tenant);
  }

  @Get('agreements')
  @RequirePermission('partner.admission.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  agreements(@Tenant() tenant: TenantContext) {
    return this.admission.agreements(tenant);
  }

  @Post('agreements/accept')
  @RequirePermission('partner.agreement.accept')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  accept(@Tenant() tenant: TenantContext, @Body() body: PartnerAgreementAcceptanceDto) {
    return this.admission.accept(tenant, body);
  }
}
