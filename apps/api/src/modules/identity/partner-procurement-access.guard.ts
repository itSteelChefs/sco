import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { forbidden } from '../../common/http/api-error.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PartnerProcurementAccessService } from './partner-procurement-access.service.js';

@Injectable()
export class PartnerProcurementAccessGuard implements CanActivate {
  constructor(@Inject(PartnerProcurementAccessService) private readonly access: PartnerProcurementAccessService) {}

  async canActivate(context: ExecutionContext) {
    const tenant = context.switchToHttp().getRequest<{ tenantContext?: TenantContext }>().tenantContext;
    if (!tenant) throw forbidden();
    await this.access.require(tenant);
    return true;
  }
}
