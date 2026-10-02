import { Body, Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PurposeGuard } from '../rbac/purpose.guard.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { PURPOSE_REQUIREMENT } from '../rbac/purpose-registry.js';
import { RequirePurpose } from '../rbac/require-purpose.decorator.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { ProcurementDocumentsService } from './procurement-documents.service.js';
import type { DocumentExtractionLine } from './extraction.contract.js';

@Controller('/api/v1/procurement-documents')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard, PurposeGuard)
export class ProcurementDocumentsController {
  constructor(@Inject(ProcurementDocumentsService) private readonly documents: ProcurementDocumentsService) {}
  @Post(':id/extract') @RequirePermission('procurement_document.extract') @RequirePurpose(PURPOSE_REQUIREMENT.DOCUMENT_CUSTODY) extract(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() body?: { lines?: DocumentExtractionLine[] }) { return this.documents.extract(tenant, id, body?.lines ?? []); }
}
