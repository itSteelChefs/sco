import { Inject, Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

@Injectable()
export class PermissionsService {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService) {}
  async has(context: TenantContext, permission: string): Promise<boolean> {
    const result = await this.tenants.withTenant(context.userId, context.companyId, (client) => client.query(
      `SELECT 1 FROM "MembershipRole" mr JOIN "RolePermission" rp ON rp.role_id = mr.role_id
       JOIN "Permission" p ON p.id = rp.permission_id
       WHERE mr.membership_id = $1 AND p.code = $2 LIMIT 1`, [context.membershipId, permission],
    ));
    return result.rowCount === 1;
  }
}
