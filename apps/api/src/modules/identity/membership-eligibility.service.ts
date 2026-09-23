import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

export type CommercialCapability = 'BUYER_PARTNERSHIP' | 'SUPPLIER_PARTNERSHIP';

@Injectable()
export class MembershipEligibilityService {
  async hasCapability(client: PoolClient, userId: string, companyId: string, capability: CommercialCapability, permissionCode: string) {
    const result = await client.query(
      `SELECT 1
       FROM "CompanyMembership" cm
       JOIN company_partnerships cp ON cp.company_id = cm."companyId" AND cp.type = $3 AND cp.status = 'ACTIVE'
       JOIN "MembershipRole" mr ON mr.membership_id = cm.id
       JOIN "RolePermission" rp ON rp.role_id = mr.role_id
       JOIN "Permission" p ON p.id = rp.permission_id AND p.code = $4
       WHERE cm."userId" = $1 AND cm."companyId" = $2 AND cm.status = 'ACTIVE'
       LIMIT 1`, [userId, companyId, capability, permissionCode],
    );
    return result.rowCount === 1;
  }
}
