import { Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import type { RequestWithAuth } from '../auth/guards/auth.guard.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { AUTHORIZATION_OPERATION } from '../authorization/authorization-operations.js';
import { AuthorizeOperation } from '../authorization/require-authorization.decorator.js';
import { ResourceAuthorizationGuard } from '../authorization/resource-authorization.guard.js';
import { WorkspaceService } from './workspace.service.js';

type WorkspaceRequest = RequestWithAuth & { correlationId?: string };

@Controller('/api/v1/partner/workspace')
@UseGuards(AuthGuard, TenantGuard, ResourceAuthorizationGuard)
export class WorkspaceController {
  constructor(@Inject(WorkspaceService) private readonly workspaces: WorkspaceService) {}

  @Get('current')
  @AuthorizeOperation(AUTHORIZATION_OPERATION.PARTNER_WORKSPACE_READ)
  current(@Tenant() tenant: TenantContext) {
    return this.workspaces.current(tenant);
  }

  @Post('current')
  @AuthorizeOperation(AUTHORIZATION_OPERATION.PARTNER_WORKSPACE_PROVISION)
  createCurrent(@Tenant() tenant: TenantContext, @Req() request: WorkspaceRequest) {
    return this.workspaces.createCurrent(tenant, request.correlationId);
  }
}
