import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { ScoInternalGuard } from '../identity/sco-internal.guard.js';
import { CandidateService } from './candidate.service.js';

@Controller('/api/v1/catalog/candidates')
export class CandidateController {
  constructor(@Inject(CandidateService) private readonly candidates: CandidateService) {}
  @Post('/internal') @UseGuards(AuthGuard, ScoInternalGuard)
  submitInternal(@Req() req: RequestWithAuth, @Body() body: { submittedName: string; requestedCategoryId?: string; brand?: string; manufacturer?: string; modelReference?: string; submittedSpecification?: unknown; unitId?: string }) { return this.candidates.submitInternal(req.scoUser!.id, body); }
  @Post() @UseGuards(AuthGuard, TenantGuard)
  submit(@Tenant() tenant: TenantContext, @Body() body: { submittedName: string; submittedDescription?: string; requestedCategoryId?: string; brand?: string; manufacturer?: string; modelReference?: string; submittedSpecification?: unknown; unitId?: string; warrantyRequirement?: string }) { return this.candidates.submitPartner(tenant, body); }
  @Get() @UseGuards(AuthGuard, TenantGuard)
  list(@Tenant() tenant: TenantContext) { return this.candidates.listPartner(tenant); }
  @Patch(':id/review') @UseGuards(AuthGuard, ScoInternalGuard)
  review(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: { status: string; reason?: string; productIdentityId?: string; explanation?: string; matchedAttributes?: unknown; differingAttributes?: unknown; missingAttributes?: unknown }) { return this.candidates.moveInternal(req.scoUser!.id, id, body.status, body.reason, body); }
}
