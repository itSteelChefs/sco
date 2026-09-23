import { Inject, Injectable } from '@nestjs/common';
import { ScoInternalTransactionService } from '../../database/sco-internal-transaction.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class PartnershipsService {
  constructor(
    @Inject(ScoInternalTransactionService) private readonly internal: ScoInternalTransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(actorUserId: string, companyId: string, type: 'BUYER_PARTNERSHIP' | 'SUPPLIER_PARTNERSHIP') {
    return this.internal.withScope(actorUserId, async (client) => {
      const result = await client.query(
        `INSERT INTO company_partnerships (company_id, type) VALUES ($1, $2)
         ON CONFLICT (company_id, type) DO NOTHING
         RETURNING id, company_id AS "companyId", type, status`, [companyId, type],
      );
      if (!result.rowCount) return null;
      await this.audit.record({ actorUserId, scope: 'SCO_INTERNAL', action: 'partnership.created', entityType: 'CompanyPartnership', entityId: result.rows[0].id, metadata: { type } });
      return result.rows[0];
    });
  }

  async activate(actorUserId: string, id: string) {
    return this.internal.withScope(actorUserId, async (client) => {
      const result = await client.query(
        `UPDATE company_partnerships SET status = 'ACTIVE', approved_by = $2, approved_at = now(), active_from = now(), updated_at = now()
         WHERE id = $1 AND status IN ('APPROVED', 'UNDER_REVIEW')
         RETURNING id, company_id AS "companyId", type, status`, [id, actorUserId],
      );
      if (!result.rowCount) return null;
      await this.audit.record({ actorUserId, scope: 'SCO_INTERNAL', action: 'partnership.activated', entityType: 'CompanyPartnership', entityId: id });
      return result.rows[0];
    });
  }
}
