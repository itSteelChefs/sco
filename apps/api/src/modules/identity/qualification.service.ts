import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ScoInternalTransactionService } from '../../database/sco-internal-transaction.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class QualificationService {
  constructor(
    @Inject(ScoInternalTransactionService) private readonly internal: ScoInternalTransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(actorUserId: string, legalName: string, contactEmail: string) {
    return this.internal.withScope(actorUserId, async (client) => {
      const result = await client.query(
        `INSERT INTO qualification_applications (legal_name, contact_email, submitted_by)
         VALUES ($1, $2, $3) RETURNING id, legal_name AS "legalName", contact_email AS "contactEmail", status`,
        [legalName, contactEmail, actorUserId],
      );
      await this.audit.record({ actorUserId, scope: 'SCO_INTERNAL', action: 'qualification.created', entityType: 'QualificationApplication', entityId: result.rows[0].id });
      return result.rows[0];
    });
  }

  async decide(actorUserId: string, id: string, status: 'APPROVED' | 'REJECTED', reason?: string) {
    return this.internal.withScope(actorUserId, async (client) => {
      const result = await client.query(
        `UPDATE qualification_applications SET status = $2, reviewed_by = $3, reviewed_at = now(), decision_reason = $4, updated_at = now()
         WHERE id = $1 AND status IN ('APPLICATION', 'UNDER_REVIEW')
         RETURNING id, status, decision_reason AS "decisionReason"`, [id, status, actorUserId, reason ?? null],
      );
      if (!result.rowCount) return null;
      await this.audit.record({ actorUserId, scope: 'SCO_INTERNAL', action: `qualification.${status.toLowerCase()}`, entityType: 'QualificationApplication', entityId: id, metadata: { reasonProvided: Boolean(reason) } });
      return result.rows[0];
    });
  }

  async list(actorUserId: string) {
    return this.internal.withScope(actorUserId, async (client) => (await client.query(
      `SELECT id, legal_name AS "legalName", contact_email AS "contactEmail", status, created_at AS "createdAt"
       FROM qualification_applications ORDER BY created_at DESC`,
    )).rows);
  }
}
