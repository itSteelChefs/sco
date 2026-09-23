import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import { ScoInternalTransactionService } from '../../database/sco-internal-transaction.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

const transitions: Record<string, string[]> = {
  SUBMITTED: ['NORMALIZED', 'CLARIFICATION_REQUIRED'],
  NORMALIZED: ['MATCH_REVIEW', 'CLARIFICATION_REQUIRED'],
  MATCH_REVIEW: ['LINKED', 'NEW_PRODUCT_PROPOSED', 'CLARIFICATION_REQUIRED', 'REJECTED'],
};

@Injectable()
export class CandidateService {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService, @Inject(ScoInternalTransactionService) private readonly internal: ScoInternalTransactionService, @Inject(AuditService) private readonly audit: AuditService) {}

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
    return this.internal.withScope(actor, async (client) => {
      const result = await client.query(`INSERT INTO product_candidates (submitted_by,origin,submitted_name,requested_category_id,brand,manufacturer,model_reference,submitted_specification,unit_id) VALUES ($1,'SCO_INTERNAL',$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id,status,submitted_name AS "submittedName"`, [actor, input.submittedName, input.requestedCategoryId ?? null, input.brand ?? null, input.manufacturer ?? null, input.modelReference ?? null, JSON.stringify(input.submittedSpecification ?? null), input.unitId ?? null]);
      await client.query(`INSERT INTO product_candidate_history (candidate_id,to_status,actor_user_id) VALUES ($1,'SUBMITTED',$2)`, [result.rows[0].id, actor]);
      await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: 'catalog.candidate_submitted', entityType: 'ProductCandidate', entityId: result.rows[0].id });
      return result.rows[0];
    });
  }

  async moveInternal(actor: string, id: string, toStatus: string, reason?: string, assessment?: { productIdentityId?: string; explanation?: string; matchedAttributes?: unknown; differingAttributes?: unknown; missingAttributes?: unknown }) {
    if (!Object.values(transitions).some((allowed) => allowed.includes(toStatus))) throw new BadRequestException({ error: { code: 'INVALID_CANDIDATE_TRANSITION' } });
    return this.internal.withScope(actor, async (client) => {
      const current = await client.query(`SELECT id,status,requested_category_id AS "requestedCategoryId",brand,manufacturer,model_reference AS "modelReference",submitted_specification AS "submittedSpecification",unit_id AS "unitId" FROM product_candidates WHERE id=$1 FOR UPDATE`, [id]);
      if (!current.rowCount || !transitions[current.rows[0].status]?.includes(toStatus)) throw new BadRequestException({ error: { code: 'INVALID_CANDIDATE_TRANSITION' } });
      if (toStatus === 'REJECTED' && !reason) throw new BadRequestException({ error: { code: 'REJECTION_REASON_REQUIRED' } });
      let linkedProductId = assessment?.productIdentityId;
      if (toStatus === 'NEW_PRODUCT_PROPOSED') {
        if (!current.rows[0].requestedCategoryId) throw new BadRequestException({ error: { code: 'CATEGORY_REQUIRED_FOR_NEW_PRODUCT' } });
        const product = await client.query(`INSERT INTO product_identities (category_id,brand,manufacturer,model_reference,public_specification,unit_id,created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id`, [current.rows[0].requestedCategoryId, current.rows[0].brand, current.rows[0].manufacturer, current.rows[0].modelReference, JSON.stringify(current.rows[0].submittedSpecification ?? null), current.rows[0].unitId, actor]);
        linkedProductId = product.rows[0].id;
      }
      if (toStatus === 'MATCH_REVIEW' || ['LINKED','NEW_PRODUCT_PROPOSED','CLARIFICATION_REQUIRED','REJECTED'].includes(toStatus)) {
        await client.query(`INSERT INTO product_match_assessments (candidate_id,product_identity_id,matched_attributes,differing_attributes,missing_attributes,explanation,decision,status,reviewed_by,decided_at) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,'DECIDED',$8,CASE WHEN $7 IS NULL THEN NULL ELSE now() END)`, [id, linkedProductId ?? null, JSON.stringify(assessment?.matchedAttributes ?? null), JSON.stringify(assessment?.differingAttributes ?? null), JSON.stringify(assessment?.missingAttributes ?? null), assessment?.explanation ?? reason ?? 'Review recorded', ['LINKED','NEW_PRODUCT_PROPOSED','CLARIFICATION_REQUIRED','REJECTED'].includes(toStatus) ? toStatus : null, actor]);
      }
      const updated = await client.query(`UPDATE product_candidates SET status=$2,normalized_specification=CASE WHEN $2='NORMALIZED' THEN submitted_specification ELSE normalized_specification END,updated_at=now() WHERE id=$1 RETURNING id,status`, [id, toStatus]);
      await client.query(`INSERT INTO product_candidate_history (candidate_id,from_status,to_status,actor_user_id,reason) VALUES ($1,$2,$3,$4,$5)`, [id, current.rows[0].status, toStatus, actor, reason ?? null]);
      await this.audit.record({ actorUserId: actor, scope: 'SCO_INTERNAL', action: `catalog.candidate_${toStatus.toLowerCase()}`, entityType: 'ProductCandidate', entityId: id, metadata: { reasonProvided: Boolean(reason) } });
      return updated.rows[0];
    });
  }
}
