import { Inject, Injectable } from '@nestjs/common';
import { forbidden, tenantContextRequired } from '../../common/http/api-error.js';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';
import type { MembershipContext } from './membership-context.js';

type MembershipRow = {
  id: string;
  userId: string;
  companyId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
};

@Injectable()
export class MembershipsService {
  constructor(@Inject(RuntimeDatabaseService) private readonly database: RuntimeDatabaseService) {}

  async requireActiveMembership(userId: string, requestedCompanyId?: string): Promise<MembershipContext> {
    const memberships = await this.database.withActor(userId, async (client) => {
      const requestedCompanyFilter = requestedCompanyId ? 'AND m."companyId" = $2' : '';
      const result = await client.query<MembershipRow>(
        `SELECT m.id, m."userId", m."companyId", m.status
         FROM "CompanyMembership" m
         JOIN "Company" c ON c.id = m."companyId"
         WHERE m."userId" = $1 AND c.status = 'ACTIVE' ${requestedCompanyFilter}`,
        requestedCompanyId ? [userId, requestedCompanyId] : [userId],
      );
      return result.rows;
    });

    if (requestedCompanyId) {
      const membership = memberships.find((item) => item.companyId === requestedCompanyId);
      if (!membership || membership.status !== 'ACTIVE') throw forbidden();
      return { membershipId: membership.id, userId: membership.userId, companyId: membership.companyId, status: 'ACTIVE' };
    }

    const activeMemberships = memberships.filter((item) => item.status === 'ACTIVE');
    if (activeMemberships.length === 0) throw forbidden();
    if (activeMemberships.length > 1) throw tenantContextRequired();
    const membership = activeMemberships[0];
    return { membershipId: membership.id, userId: membership.userId, companyId: membership.companyId, status: 'ACTIVE' };
  }
}
