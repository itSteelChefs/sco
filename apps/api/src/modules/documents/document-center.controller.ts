import { Controller, Get, Inject, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { PurposeGuard } from '../rbac/purpose.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { RequirePurpose } from '../rbac/require-purpose.decorator.js';
import { PURPOSE_REQUIREMENT } from '../rbac/purpose-registry.js';
import { parsePagination } from '../../common/http/pagination.dto.js';
import { DocumentCenterService } from './document-center.service.js';

@Controller('/api/v1/partner/documents')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard, PurposeGuard)
export class DocumentCenterController {
  constructor(@Inject(DocumentCenterService) private readonly documents: DocumentCenterService) {}

  @Get()
  @RequirePermission('partner.admission.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.DOCUMENT_CUSTODY)
  list(@Tenant() tenant: TenantContext, @Req() req: RequestWithAuth) {
    const pagination = parsePagination((req as unknown as { query?: Record<string, unknown> }).query ?? {});
    return this.documents.partnerList(tenant, pagination.page, pagination.pageSize);
  }

  @Get(':documentId/download')
  @RequirePermission('partner.admission.read')
  @RequirePurpose(PURPOSE_REQUIREMENT.DOCUMENT_CUSTODY)
  download(@Tenant() tenant: TenantContext, @Param('documentId', ParseUUIDPipe) documentId: string, @Res() reply: FastifyReply) {
    return this.documents.download(tenant, documentId, reply);
  }
}
