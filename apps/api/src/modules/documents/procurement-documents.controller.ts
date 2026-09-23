import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { ProcurementDocumentsService } from './procurement-documents.service.js';
import type { DocumentExtractionLine } from './extraction.contract.js';

@Controller('/api/v1/procurement-documents')
@UseGuards(AuthGuard, TenantGuard)
export class ProcurementDocumentsController {
  constructor(private readonly documents: ProcurementDocumentsService) {}
  @Post(':id/extract') extract(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() body: { lines?: DocumentExtractionLine[] }) { return this.documents.extract(tenant, id, body.lines ?? []); }
}
