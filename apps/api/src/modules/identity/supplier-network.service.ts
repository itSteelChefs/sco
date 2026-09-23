import { Inject, Injectable } from '@nestjs/common';
import { ScoInternalTransactionService } from '../../database/sco-internal-transaction.service.js';

@Injectable()
export class SupplierNetworkService {
  constructor(@Inject(ScoInternalTransactionService) private readonly internal: ScoInternalTransactionService) {}
  async eligibleSources(actor: string, executionItemId: string) {
    return this.internal.withScope(actor, async (client) => (await client.query(`SELECT ps.id AS "purchaseSourceId", ps.supplier_company_id AS "supplierCompanyId", ps.source_code AS "sourceCode", ps.status FROM procurement_execution_items ei JOIN product_identities pi ON pi.id=ei.product_identity_id JOIN supplier_category_capabilities scc ON scc.category_id=pi.category_id AND scc.status='ACTIVE' JOIN company_partnerships sp ON sp.id=scc.supplier_partnership_id AND sp.type='SUPPLIER_PARTNERSHIP' AND sp.status='ACTIVE' JOIN supplier_qualifications sq ON sq.supplier_partnership_id=sp.id AND sq.status='ACTIVE' JOIN purchase_sources ps ON ps.supplier_partnership_id=sp.id AND ps.status='ACTIVE' WHERE ei.id=$1`, [executionItemId])).rows);
  }

  async recordQualificationDecision(actorUserId: string, qualificationId: string, status: string, reason?: string) {
    return this.internal.withScope(actorUserId, async (client) => {
      const result = await client.query(`UPDATE supplier_qualifications SET status=$2::"SupplierQualificationStatus", qualification_notes=COALESCE($3, qualification_notes), approved_by=$1, approved_at=now(), updated_at=now() WHERE id=$4 RETURNING id, status`, [actorUserId, status, reason ?? null, qualificationId]);
      if (!result.rowCount) throw new Error('SUPPLIER_QUALIFICATION_NOT_FOUND');
      await client.query(`INSERT INTO supplier_network_history(entity_type,entity_id,action,actor_user_id,reason,metadata) VALUES ('SupplierQualification',$1,$2,$3,$4,$5::jsonb)`, [qualificationId, `qualification.${status.toLowerCase()}`, actorUserId, reason ?? null, JSON.stringify({ status })]);
      return result.rows[0];
    });
  }

  async createPurchaseSource(actorUserId: string, input: { supplierCompanyId: string; supplierPartnershipId: string; sourceCode: string; sourceTypeId: string; branchContext?: string; commercialRoute?: string; operationalContext?: string }) {
    return this.internal.withScope(actorUserId, async (client) => {
      const result = await client.query(`INSERT INTO purchase_sources(supplier_company_id,supplier_partnership_id,source_code,source_type_id,branch_context,commercial_route,operational_context,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, status`, [input.supplierCompanyId, input.supplierPartnershipId, input.sourceCode, input.sourceTypeId, input.branchContext ?? null, input.commercialRoute ?? null, input.operationalContext ?? null, actorUserId]);
      await client.query(`INSERT INTO supplier_network_history(entity_type,entity_id,action,actor_user_id,metadata) VALUES ('PurchaseSource',$1,'purchase_source.created',$2,$3::jsonb)`, [result.rows[0].id, actorUserId, JSON.stringify({ sourceCode: input.sourceCode })]);
      return result.rows[0];
    });
  }
}
