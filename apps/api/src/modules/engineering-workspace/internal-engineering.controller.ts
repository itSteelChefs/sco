import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from '../identity/sco-internal.guard.js';
import {
  InternalAssignDto,
  InternalBoqLineDto,
  InternalDHandoffDto,
  InternalTransitionDto,
} from './internal-engineering.dto.js';
import { InternalEngineeringService } from './internal-engineering.service.js';

@Controller('/api/v1/internal/engineering')
@UseGuards(AuthGuard, ScoInternalGuard)
export class InternalEngineeringController {
  constructor(@Inject(InternalEngineeringService) private readonly engineering: InternalEngineeringService) {}

  @Get('requests')
  list(@Req() req: RequestWithAuth) {
    return this.engineering.listSubmitted(req.scoUser!.id);
  }

  @Get('requests/:id')
  get(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.engineering.get(req.scoUser!.id, id);
  }

  @Post('requests/:id/assign')
  assign(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: InternalAssignDto,
  ) {
    return this.engineering.assign(req.scoUser!.id, id, body);
  }

  @Post('requests/:id/transition')
  transition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: InternalTransitionDto,
  ) {
    return this.engineering.transition(req.scoUser!.id, id, body);
  }

  @Post('requests/:id/boq-versions')
  createBoq(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.engineering.createBoqVersion(req.scoUser!.id, id);
  }

  @Get('boq-versions/:id')
  getBoq(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.engineering.getBoq(req.scoUser!.id, id);
  }

  @Post('boq-versions/:id/lines')
  upsertLine(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: InternalBoqLineDto,
  ) {
    return this.engineering.upsertLine(req.scoUser!.id, id, body);
  }

  @Post('boq-versions/:id/approve')
  approve(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.engineering.approveBoq(req.scoUser!.id, id);
  }

  @Post('boq-versions/:id/handoff-to-d')
  handoff(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: InternalDHandoffDto,
  ) {
    return this.engineering.handoffToD(req.scoUser!.id, id, body);
  }
}
