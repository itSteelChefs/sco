import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { PurposeGuard } from '../rbac/purpose.guard.js';
import { PURPOSE_REQUIREMENT } from '../rbac/purpose-registry.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { RequirePurpose } from '../rbac/require-purpose.decorator.js';
import { PartnerDocumentUploadDto } from './partner-document-upload.dto.js';
import { PartnerDocumentUploadService } from './partner-document-upload.service.js';

@Controller('/api/v1/partner/documents')
@UseGuards(AuthGuard, TenantGuard, PermissionGuard, PurposeGuard)
export class PartnerDocumentUploadController {
  constructor(@Inject(PartnerDocumentUploadService) private readonly uploads: PartnerDocumentUploadService) {}

  @Post('upload')
  @RequirePermission('partner.document.upload')
  @RequirePurpose(PURPOSE_REQUIREMENT.DOCUMENT_CUSTODY)
  upload(@Tenant() tenant: TenantContext, @Body() body: PartnerDocumentUploadDto) {
    return this.uploads.upload(tenant, body);
  }
}
