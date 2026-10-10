import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { AUTHORIZATION_OPERATION } from '../authorization/authorization-operations.js';
import { AuthorizeOperation } from '../authorization/require-authorization.decorator.js';
import { ResourceAuthorizationGuard } from '../authorization/resource-authorization.guard.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PartnerVerifyService } from './partner-verify.service.js';
import { PartnerVerifyAttachQuoteDto, PartnerVerifyCreateDto, PartnerVerifySubmitDto } from './partner-verify-write.dto.js';

@Controller('/api/v1/partner/verify')
@UseGuards(AuthGuard, TenantGuard, ResourceAuthorizationGuard)
export class PartnerVerifyController {
  constructor(@Inject(PartnerVerifyService) private readonly partnerVerify: PartnerVerifyService) {}

  @Post('requests')
  @AuthorizeOperation(AUTHORIZATION_OPERATION.PARTNER_VERIFY_REQUEST_CREATE)
  create(@Tenant() tenant: TenantContext, @Body() body: PartnerVerifyCreateDto) {
    return this.partnerVerify.createDraft(tenant, body);
  }

  @Post('requests/:requestId/quote')
  @AuthorizeOperation(AUTHORIZATION_OPERATION.PARTNER_VERIFY_QUOTE_ATTACH)
  attachQuote(
    @Tenant() tenant: TenantContext,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: PartnerVerifyAttachQuoteDto,
  ) {
    return this.partnerVerify.attachQuote(tenant, requestId, body);
  }

  @Post('requests/:requestId/submit')
  @AuthorizeOperation(AUTHORIZATION_OPERATION.PARTNER_VERIFY_REQUEST_SUBMIT)
  submit(
    @Tenant() tenant: TenantContext,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: PartnerVerifySubmitDto,
  ) {
    return this.partnerVerify.submit(tenant, requestId, body);
  }

  @Get('requests/:requestId/result')
  @AuthorizeOperation(AUTHORIZATION_OPERATION.PARTNER_VERIFY_RESULT_READ)
  getResult(@Tenant() tenant: TenantContext, @Param('requestId') requestId: string) {
    return this.partnerVerify.getResult(tenant, requestId);
  }
}
