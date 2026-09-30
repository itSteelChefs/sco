import { Inject, Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

@Injectable()
export class CandidateService {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService, @Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService, @Inject(AuditService) private readonly audit: AuditService) {}

  async submitPartner(context: TenantContext, input: { submittedName: string; submittedDescription?: string; requestedCategoryId?: string; brand?: string; manufacturer?: string; modelReference?: string; submittedSpecification?: unknown; unitId?: string; warrantyRequirement?: string }) {
    return this.tenants.withTenant(context.userId, context.companyId, async (client) => {
      const result = await client.query(`INSERT INTO product_candidates (company_id,submitted_by,origin,submitted_name,submitted_description,requested_category_id,brand,manufacturer,model_reference,submitted_specification,unit_id,warranty_requirement) VALUES ($1,$2,'PARTNER',$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING id,company_id AS "companyId",status,submitted_name AS "submittedName"`, [context.companyId, context.userId, input.submittedName, input.submittedDescription ?? null, input.requestedCategoryId ?? null, input.brand ?? null, input.manufacturer ?? null, input.modelReference ?? null, JSON.stringify(input.submittedSpecification ?? null), input.unitId ?? null, input.warrantyRequirement ?? null]);
      await client.query(`INSERT INTO product_candidate_history (candidate_id,to_status,actor_user_id) VALUES ($1,'SUBMITTED',$2)`, [result.rows[0].id, context.userId]);
      await this.audit.record({ actorUserId: context.userId, companyId: context.companyId, scope: 'TENANT', action: 'catalog.candidate_submitted', entityType: 'ProductCandidate', entityId: result.rows[0].id });
      return result.rows[0];
    });
  }

  async listPartner(context: TenantContext) {
    return this.tenants.withTenant(context.userId, context.companyId, async (client) => (await client.query(`SELECT id,status,submitted_name AS "submittedName",brand,manufacturer,model_reference AS "modelReference",created_at AS "createdAt" FROM product_candidates WHERE company_id=$1 ORDER BY created_at DESC`, [context.companyId])).rows);
  }

  async submitInternal(actor: string, input: { submittedName: string; requestedCategoryId?: string; brand?: string; manufacturer?: string; modelReference?: string; submittedSpecification?: unknown; unitId?: string }) {
    const row = await this.internal.candidateSubmitInternal(actor, input);
    await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: 'catalog.candidate_submitted', entityType: 'ProductCandidate', entityId: row.id });
    return row;
  }

  async moveInternal(actor: string, id: string, toStatus: string, reason?: string, assessment?: { productIdentityId?: string; explanation?: string; matchedAttributes?: unknown; differingAttributes?: unknown; missingAttributes?: unknown }) {
    const row = await this.internal.candidateTransition(actor, id, toStatus, reason, assessment);
    await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: `catalog.candidate_${toStatus.toLowerCase()}`, entityType: 'ProductCandidate', entityId: id, metadata: { reasonProvided: Boolean(reason) } });
    return row;
  }
}
