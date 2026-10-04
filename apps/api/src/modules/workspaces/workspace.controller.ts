import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { RequestWithAuth } from '../auth/guards/auth.guard.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PurposeGuard } from '../rbac/purpose.guard.js';
import { PURPOSE_REQUIREMENT } from '../rbac/purpose-registry.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { RequirePurpose } from '../rbac/require-purpose.decorator.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { WorkspaceService } from './workspace.service.js';

type WorkspaceRequest = RequestWithAuth & { correlationId?: string };

@Controller('/api/v1/partner/workspace')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard, PurposeGuard)
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @Get('current')
  @RequirePermission('partner.portal.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  current(@Tenant() tenant: TenantContext) {
    return this.workspaces.current(tenant);
  }

  @Post('current')
  @RequirePermission('partner.portal.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  createCurrent(@Tenant() tenant: TenantContext, @Req() request: WorkspaceRequest) {
    return this.workspaces.createCurrent(tenant, request.correlationId);
  }
}
