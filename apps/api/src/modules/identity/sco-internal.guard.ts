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
    const result = await this.database.query(
      `SELECT 1 FROM "MembershipRole" mr JOIN "RolePermission" rp ON rp.role_id = mr.role_id
       JOIN "Permission" p ON p.id = rp.permission_id
       JOIN "CompanyMembership" cm ON cm.id = mr.membership_id
       WHERE cm."userId" = $1 AND cm.status = 'ACTIVE' AND p.code = 'sco.internal.manage' LIMIT 1`, [userId],
    );
    if (result.rowCount !== 1) throw forbidden();
    return true;
  }
}
