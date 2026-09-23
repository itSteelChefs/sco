import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type RequestWithAuth } from '../auth/guards/auth.guard.js';
import { ScoInternalGuard } from '../identity/sco-internal.guard.js';
import { CatalogService } from './catalog.service.js';

@Controller('/api/v1/internal/catalog')
@UseGuards(AuthGuard, ScoInternalGuard)
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}
  @Post('categories') category(@Req() req: RequestWithAuth, @Body() body: { code: string; name: string; parentId?: string }) { return this.catalog.createCategory(req.scoUser!.id, body.code, body.name, body.parentId); }
  @Post('categories/:categoryId/attributes') attribute(@Req() req: RequestWithAuth, @Param('categoryId') categoryId: string, @Body() body: { key: string; displayName: string; dataType: string; required?: boolean; unitApplicability?: unknown; validationMetadata?: unknown }) { return this.catalog.createAttribute(req.scoUser!.id, categoryId, body); }
  @Post('products') product(@Req() req: RequestWithAuth, @Body() body: { categoryId: string; brand?: string; manufacturer?: string; modelReference?: string; publicSpecification?: unknown; unitId?: string; warrantyType?: string; warrantyPeriodMonths?: number; warrantyProvider?: string }) { return this.catalog.createProduct(req.scoUser!.id, body); }
  @Post('products/:id/activate') activate(@Req() req: RequestWithAuth, @Param('id') id: string) { return this.catalog.activateProduct(req.scoUser!.id, id); }
  @Get('products') products() { return this.catalog.listProducts(); }
}
