import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from '../identity/sco-internal.guard.js';
import {
  InternalAssessmentDto,
  InternalProcurementTransitionDto,
  InternalQuoteRecordDto,
  InternalSelectionDto,
  InternalSupplierEnsureDto,
} from './internal-procurement.dto.js';
import { InternalProcurementService } from './internal-procurement.service.js';

@Controller('/api/v1/internal/procurement')
@UseGuards(AuthGuard, ScoInternalGuard)
export class InternalProcurementController {
  constructor(@Inject(InternalProcurementService) private readonly procurement: InternalProcurementService) {}

  @Get('requirements')
  list(@Req() req: RequestWithAuth) {
    return this.procurement.listSubmitted(req.scoUser!.id);
  }

  @Get('requirements/:id')
  get(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.procurement.get(req.scoUser!.id, id);
  }

  @Post('requirements/:id/transition')
  transition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: InternalProcurementTransitionDto,
  ) {
    return this.procurement.transition(req.scoUser!.id, id, body);
  }

  @Get('suppliers')
  suppliers(@Req() req: RequestWithAuth) {
    return this.procurement.listSuppliers(req.scoUser!.id);
  }

  @Post('suppliers')
  ensureSupplier(@Req() req: RequestWithAuth, @Body() body: InternalSupplierEnsureDto) {
    return this.procurement.ensureSupplier(req.scoUser!.id, body);
  }

  @Post('requirements/:id/quotes')
  recordQuote(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: InternalQuoteRecordDto,
  ) {
    return this.procurement.recordQuote(req.scoUser!.id, id, body);
  }

  @Post('requirements/:id/comparison')
  compare(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.procurement.generateComparison(req.scoUser!.id, id);
  }

  @Post('comparisons/:comparisonId/assessments')
  assess(
    @Req() req: RequestWithAuth,
    @Param('comparisonId', ParseUUIDPipe) comparisonId: string,
    @Body() body: InternalAssessmentDto,
  ) {
    return this.procurement.assess(req.scoUser!.id, comparisonId, body);
  }

  @Post('requirements/:id/selection')
  select(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: InternalSelectionDto,
  ) {
    return this.procurement.select(req.scoUser!.id, id, body);
  }
}
