import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js'; import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { PermissionGuard } from '../rbac/permission.guard.js'; import { PurposeGuard } from '../rbac/purpose.guard.js'; import { PURPOSE_REQUIREMENT } from '../rbac/purpose-registry.js'; import { RequirePermission } from '../rbac/require-permission.decorator.js'; import { RequirePurpose } from '../rbac/require-purpose.decorator.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js'; import type { TenantContext } from '../../common/tenant/tenant-context.js';
@Controller('/api/v1/partner') @UseGuards(AuthGuard, TenantGuard, PermissionGuard, PurposeGuard)
export class PartnerController { @Get('me') @RequirePermission('partner.portal.read') @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION) me(@Tenant() tenant: TenantContext) { return { companyId: tenant.companyId, membershipId: tenant.membershipId }; } }
