import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from './sco-internal.guard.js';
import { QualificationService } from './qualification.service.js';
import { PartnershipsService } from './partnerships.service.js';
import {
  CreateAgreementPolicyDto,
  CreateQualificationDto,
  PartnershipReasonDto,
  PartnershipTypeDto,
  QualificationDecisionDto,
} from './partner-admission.dto.js';

@Controller('/api/v1/internal/network')
@UseGuards(AuthGuard, ScoInternalGuard)
export class QualificationController {
  constructor(@Inject(QualificationService) private readonly qualifications: QualificationService, @Inject(PartnershipsService) private readonly partnerships: PartnershipsService) {}

  @Post('qualifications')
  create(@Req() req: RequestWithAuth, @Body() body: CreateQualificationDto) {
    return this.qualifications.create(req.scoUser!.id, body.legalName, body.contactEmail, body.companyId);
  }

  @Get('qualifications')
  list(@Req() req: RequestWithAuth) { return this.qualifications.list(req.scoUser!.id); }

  @Patch('qualifications/:id/decision')
  decide(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: QualificationDecisionDto) {
    return this.qualifications.decide(req.scoUser!.id, id, body.status, body.reason);
  }

  @Post('companies/:companyId/partnerships')
  createPartnership(@Req() req: RequestWithAuth, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() body: PartnershipTypeDto) {
    return this.partnerships.create(req.scoUser!.id, companyId, body.type);
  }

  @Post('partnerships/:id/activate')
  activate(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) { return this.partnerships.activate(req.scoUser!.id, id); }

  @Post('partnerships/:id/approve')
  approve(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: PartnershipReasonDto) {
    return this.partnerships.approve(req.scoUser!.id, id, body.reason);
  }

  @Post('partnerships/:id/reject')
  reject(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: PartnershipReasonDto) {
    return this.partnerships.reject(req.scoUser!.id, id, body.reason);
  }

  @Post('partnerships/:id/suspend')
  suspend(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: PartnershipReasonDto) {
    return this.partnerships.suspend(req.scoUser!.id, id, body.reason);
  }

  @Post('partnerships/:id/revoke')
  revoke(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: PartnershipReasonDto) {
    return this.partnerships.revoke(req.scoUser!.id, id, body.reason);
  }

  @Post('agreement-policies')
  createAgreementPolicy(@Req() req: RequestWithAuth, @Body() body: CreateAgreementPolicyDto) {
    return this.partnerships.createAgreementPolicy(req.scoUser!.id, body);
  }

  @Post('agreement-policies/:id/publish')
  publishAgreementPolicy(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.partnerships.publishAgreementPolicy(req.scoUser!.id, id);
  }

  @Post('agreement-policies/:id/suspend')
  suspendAgreementPolicy(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: PartnershipReasonDto) {
    return this.partnerships.transitionAgreementPolicy(req.scoUser!.id, id, 'SUSPENDED', body.reason);
  }

  @Post('agreement-policies/:id/terminate')
  terminateAgreementPolicy(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: PartnershipReasonDto) {
    return this.partnerships.transitionAgreementPolicy(req.scoUser!.id, id, 'TERMINATED', body.reason);
  }
}
