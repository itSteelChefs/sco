import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from '../identity/sco-internal.guard.js';
import {
  ConfirmSupplierOrderDto,
  CreateAllocationDto,
  CreatePurchaseFromSelectionDto,
  CreateResaleOrderDto,
  CreateSupplierOrderDto,
} from './internal-buy-resell.dto.js';
import { InternalBuyResellService } from './internal-buy-resell.service.js';

@Controller('/api/v1/internal/commercial')
@UseGuards(AuthGuard, ScoInternalGuard)
export class InternalBuyResellController {
  constructor(@Inject(InternalBuyResellService) private readonly commercial: InternalBuyResellService) {}

  @Post('purchases/from-selection')
  createPurchase(@Req() req: RequestWithAuth, @Body() body: CreatePurchaseFromSelectionDto) {
    return this.commercial.createPurchaseFromSelection(req.scoUser!.id, body);
  }

  @Get('purchases/:id')
  getPurchase(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.getIntent(req.scoUser!.id, id);
  }

  @Post('purchases/:id/approve')
  approvePurchase(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.approvePurchase(req.scoUser!.id, id);
  }

  @Post('supplier-orders')
  createOrder(@Req() req: RequestWithAuth, @Body() body: CreateSupplierOrderDto) {
    return this.commercial.createSupplierOrder(req.scoUser!.id, body);
  }

  @Get('supplier-orders/:id')
  getOrder(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.getSupplierOrder(req.scoUser!.id, id);
  }

  @Post('supplier-orders/:id/approve')
  approveOrder(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.approveSupplierOrder(req.scoUser!.id, id);
  }

  @Post('supplier-orders/:id/issue')
  issueOrder(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.issueSupplierOrder(req.scoUser!.id, id);
  }

  @Post('supplier-orders/:id/confirm')
  confirmOrder(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmSupplierOrderDto,
  ) {
    return this.commercial.confirmSupplierOrder(req.scoUser!.id, id, body);
  }

  @Post('allocations')
  allocate(@Req() req: RequestWithAuth, @Body() body: CreateAllocationDto) {
    return this.commercial.createAllocation(req.scoUser!.id, body);
  }

  @Get('allocations/:id')
  getAllocation(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.getAllocation(req.scoUser!.id, id);
  }

  @Post('resale-orders')
  createResale(@Req() req: RequestWithAuth, @Body() body: CreateResaleOrderDto) {
    return this.commercial.createResale(req.scoUser!.id, body);
  }

  @Get('resale-orders/:id')
  getResale(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.getResaleInternal(req.scoUser!.id, id);
  }

  @Post('resale-orders/:id/approve')
  approveResale(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.approveResale(req.scoUser!.id, id);
  }

  @Post('resale-orders/:id/confirm')
  confirmResale(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.commercial.confirmResale(req.scoUser!.id, id);
  }
}
