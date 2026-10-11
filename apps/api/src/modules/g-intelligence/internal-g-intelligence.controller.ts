import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from '../identity/sco-internal.guard.js';
import {
  GBackfillDto,
  GDemandQueryDto,
  GEvidenceQueryDto,
  GPriceHistoryQueryDto,
} from './g-intelligence.dto.js';
import { InternalGIntelligenceService } from './internal-g-intelligence.service.js';

@Controller('/api/v1/internal/g-intelligence')
@UseGuards(AuthGuard, ScoInternalGuard)
export class InternalGIntelligenceController {
  constructor(@Inject(InternalGIntelligenceService) private readonly intelligence: InternalGIntelligenceService) {}

  @Post('backfill')
  backfill(@Req() req: RequestWithAuth, @Body() body: GBackfillDto) {
    return this.intelligence.backfill(req.scoUser!.id, body);
  }

  @Get('price-history')
  priceHistory(@Req() req: RequestWithAuth, @Query() query: GPriceHistoryQueryDto) {
    return this.intelligence.priceHistory(req.scoUser!.id, query);
  }

  @Get('quotes/:quoteLineId/benchmark')
  benchmark(@Req() req: RequestWithAuth, @Param('quoteLineId', ParseUUIDPipe) quoteLineId: string) {
    return this.intelligence.quoteBenchmark(req.scoUser!.id, quoteLineId);
  }

  @Get('suppliers/:supplierCompanyId/performance')
  supplier(
    @Req() req: RequestWithAuth,
    @Param('supplierCompanyId', ParseUUIDPipe) supplierCompanyId: string,
  ) {
    return this.intelligence.supplierPerformance(req.scoUser!.id, supplierCompanyId);
  }

  @Get('categories/:sector')
  category(@Req() req: RequestWithAuth, @Param('sector') sector: string) {
    return this.intelligence.category(req.scoUser!.id, sector);
  }

  @Get('demand')
  demand(@Req() req: RequestWithAuth, @Query() query: GDemandQueryDto) {
    return this.intelligence.demand(req.scoUser!.id, query);
  }

  @Get('decision-support/quotes/:quoteLineId')
  decisionSupport(@Req() req: RequestWithAuth, @Param('quoteLineId', ParseUUIDPipe) quoteLineId: string) {
    return this.intelligence.decisionSupport(req.scoUser!.id, quoteLineId);
  }

  @Get('evidence')
  evidence(@Req() req: RequestWithAuth, @Query() query: GEvidenceQueryDto) {
    return this.intelligence.evidence(req.scoUser!.id, query);
  }
}
