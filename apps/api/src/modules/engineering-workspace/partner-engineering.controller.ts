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
import { PartnerEngineeringDocumentLinkDto, PartnerEngineeringRequestDraftDto } from './partner-engineering.dto.js';
import { PartnerEngineeringService } from './partner-engineering.service.js';

@Controller('/api/v1/partner/engineering/requests')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard, PurposeGuard)
export class PartnerEngineeringController {
  constructor(@Inject(PartnerEngineeringService) private readonly engineering: PartnerEngineeringService) {}

  @Get()
  @RequirePermission('engineering.request.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  list(@Tenant() tenant: TenantContext) {
    return this.engineering.list(tenant);
  }

  @Post()
  @RequirePermission('engineering.request.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  create(@Tenant() tenant: TenantContext, @Body() body: PartnerEngineeringRequestDraftDto) {
    return this.engineering.create(tenant, body);
  }

  @Get(':id')
  @RequirePermission('engineering.request.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.engineering.get(tenant, id);
  }

  @Put(':id')
  @RequirePermission('engineering.request.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PartnerEngineeringRequestDraftDto,
  ) {
    return this.engineering.updateDraft(tenant, id, body);
  }

  @Post(':id/submit')
  @RequirePermission('engineering.request.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  submit(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.engineering.submit(tenant, id);
  }

  @Post(':id/documents')
  @RequirePermission('engineering.request.write')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  linkDocument(
    @Tenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PartnerEngineeringDocumentLinkDto,
  ) {
    return this.engineering.linkDocument(tenant, id, body);
  }

  @Get(':id/result')
  @RequirePermission('engineering.request.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  result(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.engineering.result(tenant, id);
  }

  @Get(':id/result/export')
  @RequirePermission('engineering.request.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.AUTHORIZATION)
  resultCsv(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.engineering.resultCsv(tenant, id);
  }
}
