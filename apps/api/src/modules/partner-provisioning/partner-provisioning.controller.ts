import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiError, forbidden } from '../../common/http/api-error.js';
import { HttpStatus } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from '../identity/sco-internal.guard.js';
import { PartnerProvisioningService } from './partner-provisioning.service.js';
import type { PartnerMembershipProvisionInput } from './partner-provisioning.types.js';
@Controller('/api/v1/internal/partner-memberships') @UseGuards(AuthGuard, ScoInternalGuard)
export class PartnerProvisioningController {
  constructor(@Inject(PartnerProvisioningService) private readonly service: PartnerProvisioningService) {}
  @Post()
  provision(@Req() req: RequestWithAuth, @Body() body: PartnerMembershipProvisionInput) {
    if (!req.scoUser) throw forbidden();
    const allowed = new Set(['targetUserId', 'targetCompanyId', 'operationKey']);
    if (!body || typeof body !== 'object' || Object.keys(body).some((key) => !allowed.has(key))) {
      throw new ApiError('PARTNER_PROVISIONING_INPUT_INVALID', HttpStatus.BAD_REQUEST);
    }
    return this.service.provision(req.scoUser.id, body);
  }
}
