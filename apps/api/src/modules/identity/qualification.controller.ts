import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from './sco-internal.guard.js';
import { QualificationService } from './qualification.service.js';
import { PartnershipsService } from './partnerships.service.js';

@Controller('/api/v1/internal/network')
@UseGuards(AuthGuard, ScoInternalGuard)
export class QualificationController {
  constructor(@Inject(QualificationService) private readonly qualifications: QualificationService, @Inject(PartnershipsService) private readonly partnerships: PartnershipsService) {}

  @Post('qualifications')
  create(@Req() req: RequestWithAuth, @Body() body: { legalName?: string; contactEmail?: string }) {
    return this.qualifications.create(req.scoUser!.id, String(body.legalName ?? ''), String(body.contactEmail ?? ''));
  }

  @Get('qualifications')
  list(@Req() req: RequestWithAuth) { return this.qualifications.list(req.scoUser!.id); }

  @Patch('qualifications/:id/decision')
  decide(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: { status?: 'APPROVED' | 'REJECTED'; reason?: string }) {
    return this.qualifications.decide(req.scoUser!.id, id, body.status!, body.reason);
  }

  @Post('companies/:companyId/partnerships')
  createPartnership(@Req() req: RequestWithAuth, @Param('companyId') companyId: string, @Body() body: { type?: 'BUYER_PARTNERSHIP' | 'SUPPLIER_PARTNERSHIP' }) {
    return this.partnerships.create(req.scoUser!.id, companyId, body.type!);
  }

  @Post('partnerships/:id/activate')
  activate(@Req() req: RequestWithAuth, @Param('id') id: string) { return this.partnerships.activate(req.scoUser!.id, id); }
}
