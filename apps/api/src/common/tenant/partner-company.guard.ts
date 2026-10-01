import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { forbidden } from '../http/api-error.js';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';
import type { TenantContext } from './tenant-context.js';

// TenantGuard only proves an ACTIVE membership in an ACTIVE company; it never asserts company type.
// Partner-only surfaces must not trust a client-supplied type, so this re-checks Company.type server-side.
@Injectable()
export class PartnerCompanyGuard implements CanActivate {
  constructor(@Inject(RuntimeDatabaseService) private readonly database: RuntimeDatabaseService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ tenantContext?: TenantContext }>();
    const tenant = request.tenantContext;
    if (!tenant) throw forbidden();
    const result = await this.database.query(
      `SELECT 1 FROM "Company" WHERE id = $1 AND type = 'PARTNER' AND status = 'ACTIVE'`,
      [tenant.companyId],
    );
    if (result.rowCount !== 1) throw forbidden();
    return true;
  }
}
