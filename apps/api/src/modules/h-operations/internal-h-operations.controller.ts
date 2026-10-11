import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from '../identity/sco-internal.guard.js';
import {
  HAssignDto,
  HConfigSetDto,
  HCycleCreateDto,
  HCycleOverrideDto,
  HExceptionUpsertDto,
  HJobEnqueueDto,
  HQueueQueryDto,
  HResolveDto,
  HTransitionDto,
  HWorkUpsertDto,
} from './h-operations.dto.js';
import { InternalHOperationsService } from './internal-h-operations.service.js';

@Controller('/api/v1/internal/h-operations')
@UseGuards(AuthGuard, ScoInternalGuard)
export class InternalHOperationsController {
  constructor(@Inject(InternalHOperationsService) private readonly ops: InternalHOperationsService) {}

  @Post('work-items')
  upsertWork(@Req() req: RequestWithAuth, @Body() body: HWorkUpsertDto) {
    return this.ops.upsertWork(req.scoUser!.id, body);
  }

  @Get('work-items')
  queue(@Req() req: RequestWithAuth, @Query() query: HQueueQueryDto) {
    return this.ops.queue(req.scoUser!.id, query);
  }

  @Post('work-items/:id/assign')
  assign(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: HAssignDto) {
    return this.ops.assign(req.scoUser!.id, id, body);
  }

  @Post('work-items/:id/transition')
  transition(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: HTransitionDto) {
    return this.ops.transition(req.scoUser!.id, id, body);
  }

  @Post('exceptions')
  upsertException(@Req() req: RequestWithAuth, @Body() body: HExceptionUpsertDto) {
    return this.ops.upsertException(req.scoUser!.id, body);
  }

  @Get('exceptions/:id')
  getException(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.getException(req.scoUser!.id, id);
  }

  @Post('exceptions/:id/ack')
  ack(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.ackException(req.scoUser!.id, id);
  }

  @Post('exceptions/:id/retry')
  retry(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.retryException(req.scoUser!.id, id);
  }

  @Post('exceptions/:id/resolve')
  resolve(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: HResolveDto) {
    return this.ops.resolveException(req.scoUser!.id, id, body);
  }

  @Post('cycles')
  createCycle(@Req() req: RequestWithAuth, @Body() body: HCycleCreateDto) {
    return this.ops.createCycle(req.scoUser!.id, body);
  }

  @Get('cycles/:id')
  getCycle(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.getCycle(req.scoUser!.id, id);
  }

  @Post('cycles/:id/lock')
  lockCycle(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.lockCycle(req.scoUser!.id, id);
  }

  @Post('cycles/:id/complete')
  completeCycle(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.completeCycle(req.scoUser!.id, id);
  }

  @Post('cycles/:id/override-include')
  override(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: HCycleOverrideDto) {
    return this.ops.overrideCycle(req.scoUser!.id, id, body);
  }

  @Get('notifications')
  notifications(
    @Req() req: RequestWithAuth,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.ops.notifications(req.scoUser!.id, unreadOnly === 'true', limit ? Number(limit) : 50, offset ? Number(offset) : 0);
  }

  @Post('notifications/:id/read')
  markRead(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.markRead(req.scoUser!.id, id, false);
  }

  @Post('notifications/read-all')
  markAll(@Req() req: RequestWithAuth) {
    return this.ops.markRead(req.scoUser!.id, null, true);
  }

  @Post('jobs')
  enqueue(@Req() req: RequestWithAuth, @Body() body: HJobEnqueueDto) {
    return this.ops.enqueueJob(req.scoUser!.id, body);
  }

  @Post('jobs/:id/run')
  runJob(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.ops.runJob(req.scoUser!.id, id);
  }

  @Get('health')
  health(@Req() req: RequestWithAuth) {
    return this.ops.health(req.scoUser!.id);
  }

  @Get('config')
  getConfig(@Req() req: RequestWithAuth) {
    return this.ops.getConfig(req.scoUser!.id);
  }

  @Post('config')
  setConfig(@Req() req: RequestWithAuth, @Body() body: HConfigSetDto) {
    return this.ops.setConfig(req.scoUser!.id, body);
  }

  @Get('audit-evidence')
  audit(@Req() req: RequestWithAuth, @Query() query: Record<string, string>) {
    return this.ops.auditEvidence(req.scoUser!.id, query);
  }
}
