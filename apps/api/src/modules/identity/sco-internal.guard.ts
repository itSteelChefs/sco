import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { forbidden } from '../../common/http/api-error.js';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';
import type { RequestWithAuth } from '../auth/guards/auth.guard.js';

@Injectable()
export class ScoInternalGuard implements CanActivate {
  constructor(@Inject(RuntimeDatabaseService) private readonly database: RuntimeDatabaseService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const userId = request.scoUser?.id;
    if (!userId) throw forbidden();
    // Resolve every eligible SCO membership under the actor context, then fail closed unless exactly one has the capability.
    const authorized = await this.database.withActor(userId, async (client) => {
      const memberships = await client.query<{ membershipId: string; companyId: string }>(
        `SELECT cm.id AS "membershipId", cm."companyId" AS "companyId"
         FROM "CompanyMembership" cm JOIN "Company" co ON co.id = cm."companyId"
         WHERE cm."userId" = $1 AND cm.status = 'ACTIVE' AND co.type = 'SCO' AND co.status = 'ACTIVE'
         ORDER BY cm.id`, [userId],
      );
      const eligible = [];
      for (const membership of memberships.rows) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [membership.companyId]);
        const capability = await client.query(
          `SELECT 1 FROM "MembershipRole" mr JOIN "RolePermission" rp ON rp.role_id = mr.role_id
           JOIN "Permission" p ON p.id = rp.permission_id
           WHERE mr.membership_id = $1 AND p.code = 'sco.internal.manage' LIMIT 1`,
          [membership.membershipId],
        );
        if (capability.rowCount === 1) eligible.push(membership);
      }
      return eligible.length === 1;
    });
    if (!authorized) throw forbidden();
    return true;
  }
}
