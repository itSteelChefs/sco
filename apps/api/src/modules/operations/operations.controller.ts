import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { Tenant } from '../../common/tenant/tenant.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import { parsePagination } from '../../common/http/pagination.dto.js';
@Controller('/api/v1/internal') @UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class OperationsController {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService) {}
  @Get('companies') @RequirePermission('identity.company.read')
  async companies(@Tenant() tenant: TenantContext, @Query() query: Record<string, unknown>) {
    const pagination = parsePagination(query);
    const result = await this.tenants.withTenant(tenant.userId, tenant.companyId, c => c.query(
      'SELECT id, name, type, status FROM "Company" WHERE id = $1 ORDER BY id LIMIT $2 OFFSET $3',
      [tenant.companyId, pagination.pageSize, (pagination.page - 1) * pagination.pageSize],
    ));
    return { items: result.rows, page: pagination.page, pageSize: pagination.pageSize };
  }
}
