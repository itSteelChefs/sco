import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { MetricsService } from '../observability/metrics.service.js';
import { createObservedPool } from './observed-pool.js';
import type { PartnerMembershipProvisionResult } from '../modules/partner-provisioning/partner-provisioning.types.js';

export type PricingAllocationInput = { snapshotId: string; quantity: number; fxRate?: number; asOfDate?: string; fxReason?: string };
export type PricingLineInput = { lineNumber: number; productIdentityId: string; quantity: number; unitId: string; unitSellingPrice: number; taxTreatmentCode?: string; taxRate?: number; taxAmount?: number; allocations: PricingAllocationInput[] };
export type DirectDealCostInput = { lineNumber: number; type: string; description?: string; currency: string; amount: number; fxRate?: number; asOfDate?: string; fxReason?: string };
export type CreatePricingInput = { caseId?: string; partnerCompanyId: string; currency: string; lines: PricingLineInput[]; directCosts?: DirectDealCostInput[]; overhead?: number; overheadReason?: string; correlationId?: string };
export type ProcurementIntelligenceTransactionBinding = {
  backendPid: number;
  transactionId: string;
};
export type ProcurementIntelligenceRunInput = {
  actorUserId: string;
  sourceBuyingPowerSnapshotId: string;
  requestKey: string;
  correlationId?: string;
};
export type ServiceEntitlementState = 'ACTIVE' | 'DISABLED' | 'REVOKED';
export type ServiceAccessTransactionBinding = {
  backendPid: number;
  transactionId: string;
};
export type ServiceAccessAuthorizationInput = {
  actorUserId: string;
  targetCompanyId: string;
  serviceCode: string;
  resourceContext: string;
  correlationId?: string;
};
export type ServiceAccessWorkspaceSummary = {
  id: string;
  displayName: string;
  state: string;
  version: number;
};
export type InternalPartnershipReadiness = {
  partnershipId: string;
  companyId: string;
  companyDisplayName: string;
  partnershipType: string;
  partnershipStatus: string;
  qualificationStatus: string | null;
  qualificationReady: boolean;
  requiredAgreementsSatisfied: boolean;
  companyStatus: string;
  companyActive: boolean;
  activePortalMembershipReady: boolean;
  partnerPortalReadReady: boolean;
  nextInternalAction: 'APPROVE' | 'ACTIVATE' | 'NONE';
  actionReady: boolean;
  blockers: string[];
  createdAt: Date;
  updatedAt: Date;
};
type InternalPartnershipReadinessRow = {
  partnership_id: string;
  company_id: string;
  company_display_name: string;
  partnership_type: string;
  partnership_status: string;
  qualification_status: string | null;
  qualification_ready: boolean;
  required_agreements_satisfied: boolean;
  company_status: string;
  company_active: boolean;
  active_portal_membership_ready: boolean;
  partner_portal_read_ready: boolean;
  next_internal_action: 'APPROVE' | 'ACTIVATE' | 'NONE';
  action_ready: boolean;
  blockers: string[];
  created_at: Date;
  updated_at: Date;
};

function mapInternalPartnershipReadiness(row: InternalPartnershipReadinessRow): InternalPartnershipReadiness {
  return {
    partnershipId: row.partnership_id,
    companyId: row.company_id,
    companyDisplayName: row.company_display_name,
    partnershipType: row.partnership_type,
    partnershipStatus: row.partnership_status,
    qualificationStatus: row.qualification_status,
    qualificationReady: row.qualification_ready,
    requiredAgreementsSatisfied: row.required_agreements_satisfied,
    companyStatus: row.company_status,
    companyActive: row.company_active,
    activePortalMembershipReady: row.active_portal_membership_ready,
    partnerPortalReadReady: row.partner_portal_read_ready,
    nextInternalAction: row.next_internal_action,
    actionReady: row.action_ready,
    blockers: row.blockers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
@Injectable()
export class InternalDatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  constructor(@Optional() @Inject(MetricsService) metrics?: MetricsService) {
    this.pool = createObservedPool(process.env.SCO_INTERNAL_DATABASE_URL, 'internal', metrics);
  }
  async onModuleDestroy() { await this.pool.end(); }
  async ping(): Promise<void> { await this.pool.query('SELECT 1'); }
  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async runProcurementIntelligence(
    input: ProcurementIntelligenceRunInput,
    authorize: (binding: ProcurementIntelligenceTransactionBinding) => Promise<string>,
  ): Promise<{ runId: string; snapshotId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const binding = await this.procurementIntelligenceTransactionBinding(client);
      const decisionId = await authorize(binding);
      const result = await client.query<{ run_id: string; snapshot_id: string }>(
        'SELECT * FROM public.internal_procurement_intelligence_run($1, $2, $3, $4::uuid, $5)',
        [
          input.actorUserId,
          input.sourceBuyingPowerSnapshotId,
          input.requestKey,
          input.correlationId ?? null,
          decisionId,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Procurement Intelligence gateway did not return a result.');
      await client.query('COMMIT');
      return { runId: row.run_id, snapshotId: row.snapshot_id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

    async setServiceEntitlement(
      actorUserId: string,
      companyId: string,
      serviceCode: string,
      state: ServiceEntitlementState,
    ): Promise<string> {
      const result = await this.pool.query<{ id: string }>(
        'SELECT public.internal_service_entitlement_set($1, $2, $3, $4::"ServiceEntitlementState") AS id',
        [actorUserId, companyId, serviceCode, state],
      );
      if (!result.rows[0]?.id) throw new Error('Service entitlement gateway did not return an identifier.');
      return result.rows[0].id;
    }
    async createServiceAccessGrant(
      issuerUserId: string,
      actorUserId: string,
      targetCompanyId: string,
      serviceCode: string,
      expiresAt: string,
      idempotencyKey: string,
      correlationId?: string,
    ): Promise<string> {
      const result = await this.pool.query<{ id: string }>(
        'SELECT public.internal_service_access_grant_create($1, $2, $3, $4, $5::timestamptz, $6, $7) AS id',
        [issuerUserId, actorUserId, targetCompanyId, serviceCode, expiresAt, idempotencyKey, correlationId ?? null],
      );
      if (!result.rows[0]?.id) throw new Error('Service access grant gateway did not return an identifier.');
      return result.rows[0].id;
    }
    async revokeServiceAccessGrant(
      issuerUserId: string,
      grantId: string,
      reason: string,
      correlationId?: string,
    ): Promise<void> {
      await this.pool.query(
        'SELECT public.internal_service_access_grant_revoke($1, $2, $3, $4)',
        [issuerUserId, grantId, reason, correlationId ?? null],
      );
    }
    async authorizeServiceAccess(
      input: ServiceAccessAuthorizationInput,
      consume: (binding: ServiceAccessTransactionBinding) => Promise<string>,
    ): Promise<string> {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const binding = await this.serviceAccessTransactionBinding(client);
        const decisionId = await consume(binding);
        const result = await client.query<{ id: string }>(
          'SELECT public.internal_service_access_authorize($1, $2, $3, $4, $5, $6) AS id',
          [
            input.actorUserId,
            input.targetCompanyId,
            input.serviceCode,
            input.resourceContext,
            decisionId,
            input.correlationId ?? null,
          ],
        );
        const row = result.rows[0];
        if (!row?.id) throw new Error('Service access authorization gateway did not return an identifier.');
        await client.query('COMMIT');
        return row.id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  async getServiceAccessWorkspace(
    input: ServiceAccessAuthorizationInput,
    consume: (binding: ServiceAccessTransactionBinding) => Promise<string>,
  ): Promise<ServiceAccessWorkspaceSummary> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const binding = await this.serviceAccessTransactionBinding(client);
      const decisionId = await consume(binding);
      const result = await client.query<{
        workspace_id: string;
        display_name: string;
        state: string;
        version: number;
      }>(
        'SELECT * FROM public.internal_partner_workspace_service_access_summary($1, $2, $3, $4, $5, $6)',
        [
          input.actorUserId,
          input.targetCompanyId,
          input.serviceCode,
          input.resourceContext,
          decisionId,
          input.correlationId ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Service Access Workspace gateway did not return a result.');
      await client.query('COMMIT');
      return {
        id: row.workspace_id,
        displayName: row.display_name,
        state: row.state,
        version: row.version,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async procurementIntelligenceTransactionBinding(client: PoolClient): Promise<ProcurementIntelligenceTransactionBinding> {
    const result = await client.query<{ backend_pid: number; transaction_id: string }>(
      'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
    );
    const row = result.rows[0];
    if (!row) throw new Error('Unable to bind Procurement Intelligence transaction authority.');
    return { backendPid: row.backend_pid, transactionId: row.transaction_id };
  }
  private async serviceAccessTransactionBinding(client: PoolClient): Promise<ServiceAccessTransactionBinding> {
    const result = await client.query<{ backend_pid: number; transaction_id: string }>(
      'SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id',
    );
    const row = result.rows[0];
    if (!row) throw new Error('Unable to bind Service Access transaction authority.');
    return {
      backendPid: row.backend_pid,
      transactionId: row.transaction_id,
    };
  }
  async createDisclosureAlias(actor: string, input: { ownerCompanyId: string; recipientCompanyId: string; recipientContext: string; resourceType: string; resourceId: string; identityClass: string; subjectReference: string; alias: string }) {
    return (await this.pool.query<{ id: string }>(
      'SELECT public.internal_disclosure_alias_create($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id',
      [actor, input.ownerCompanyId, input.recipientCompanyId, input.recipientContext, input.resourceType, input.resourceId, input.identityClass, input.subjectReference, input.alias],
    )).rows[0];
  }
  async retireDisclosureAlias(actor: string, aliasId: string): Promise<void> {
    await this.pool.query('SELECT public.internal_disclosure_alias_retire($1,$2)', [actor, aliasId]);
  }
  async provisionPartnerMembership(
    actor: string,
    targetUserId: string,
    targetCompanyId: string,
    operationKey: string,
  ): Promise<PartnerMembershipProvisionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_id', $1, true)", [actor]);
      const authority = await client.query<{ authority_company_id: string }>(
        'SELECT public.internal_partner_provision_authority($1) AS authority_company_id',
        [actor],
      );
      const authorityCompanyId = authority.rows[0]?.authority_company_id;
      if (!authorityCompanyId) throw new Error('PARTNER_PROVISION_AUTHORITY_FORBIDDEN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [authorityCompanyId]);
      const result = await client.query<{
        operation_id: string;
        membership_id: string;
        user_id: string;
        company_id: string;
        membership_status: string;
        outcome: PartnerMembershipProvisionResult['outcome'];
      }>('SELECT * FROM public.internal_partner_membership_provision($1,$2,$3)', [targetUserId, targetCompanyId, operationKey]);
      const row = result.rows[0];
      if (!row) throw new Error('PARTNER_PROVISION_RESULT_MISSING');
      await client.query('COMMIT');
      return {
        operationId: row.operation_id,
        membershipId: row.membership_id,
        userId: row.user_id,
        companyId: row.company_id,
        membershipStatus: row.membership_status,
        outcome: row.outcome,
      };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  poolStats() { return { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount }; }
  async canSelfApprovePurchaseCost(actorId: string): Promise<boolean> { const result=await this.pool.query('SELECT public.can_self_approve_purchase_cost($1) AS allowed',[actorId]); return result.rows[0].allowed===true; }
  async canApprovePurchaseCost(actorId: string): Promise<boolean> { const result=await this.pool.query('SELECT public.can_approve_purchase_cost($1) AS allowed',[actorId]); return result.rows[0].allowed===true; }
  async createProcurementNeed(actor: string, companyId: string, input: { description: string; quantity: number; unitId?: string; needDate: string; projectId?: string; productIdentityId?: string; productCandidateId?: string }, correlationId: string) {
    return (await this.pool.query(
      `SELECT * FROM public.internal_procurement_need_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [actor, companyId, input.description, input.quantity, input.unitId ?? null, input.needDate, input.projectId ?? null, input.productIdentityId ?? null, input.productCandidateId ?? null, correlationId],
    )).rows[0];
  }
  async supplierQuoteDocument(actorId: string, documentId: string) { const result=await this.pool.query<{filename:string;detected_mime_type:string;byte_size:number;storage_key:string}>('SELECT * FROM public.get_supplier_quote_document($1,$2)',[documentId,actorId]); return result.rows[0] ?? null; }
  async createRfq(actor:string, executionItemIds:string[], expiresAt?:string, notes?:string, correlationId?:string) { return (await this.pool.query('SELECT public.internal_rfq_create($1,$2::uuid[],$3,$4,$5) AS id',[actor,executionItemIds,expiresAt??null,notes??null,correlationId??null])).rows[0]; }
  async transitionRfq(actor:string,id:string,next:string,reason?:string,correlationId?:string) { return (await this.pool.query('SELECT * FROM public.internal_rfq_transition($1,$2,$3,$4,$5)',[actor,id,next,reason??null,correlationId??null])).rows[0]; }
  async addRfqRecipient(actor:string,rfqId:string,sourceId:string,correlationId?:string) { return (await this.pool.query('SELECT * FROM public.internal_rfq_add_recipient($1,$2,$3,$4)',[actor,rfqId,sourceId,correlationId??null])).rows[0]; }
  async recordQuote(actor:string,input:{rfqId:string;purchaseSourceId:string;supplierCompanyId:string;quoteReference?:string;currency:string;items:Array<{rfqItemId:string;productIdentityId:string;quantity:number;unitPrice:number}>},correlationId?:string) { return (await this.pool.query('SELECT * FROM public.internal_quote_record($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[actor,input.rfqId,input.purchaseSourceId,input.supplierCompanyId,input.quoteReference??null,input.currency,JSON.stringify(input.items),correlationId??null])).rows[0]; }
  async reviseQuote(actor:string,quoteId:string,input:{currency:string;reason:string;items:Array<{rfqItemId:string;productIdentityId:string;quantity:number;unitPrice:number}>},correlationId?:string) { return (await this.pool.query('SELECT * FROM public.internal_quote_revise($1,$2,$3,$4,$5::jsonb,$6)',[actor,quoteId,input.currency,input.reason,JSON.stringify(input.items),correlationId??null])).rows[0]; }
  async recordNegotiation(actor:string,input:{rfqId:string;revisionId?:string;direction:string;eventType:string;reason?:string;metadata?:Record<string,unknown>},correlationId?:string) { return (await this.pool.query('SELECT public.internal_negotiation_record($1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS id',[actor,input.rfqId,input.revisionId??null,input.direction,input.eventType,input.reason??null,JSON.stringify(input.metadata??{}),correlationId??null])).rows[0]; }
  async approvePurchaseCost(actor:string,input:{rfqItemId:string;revisionId:string;sourceId:string;supplierCompanyId:string;productIdentityId:string;quantity:number;currency:string;unitCost:number;reason:string;selfApprove?:boolean;correlationId?:string}) { return (await this.pool.query('SELECT public.internal_purchase_cost_approve($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS id',[actor,input.rfqItemId,input.revisionId,input.sourceId,input.supplierCompanyId,input.productIdentityId,input.quantity,input.currency,input.unitCost,input.reason,Boolean(input.selfApprove),input.correlationId??null])).rows[0]; }
  async reviewAlternativeProduct(actor:string,id:string,decision:string,reason:string,correlationId?:string) { return (await this.pool.query('SELECT * FROM public.internal_alternative_product_review($1,$2,$3,$4,$5)',[actor,id,decision,reason,correlationId??null])).rows[0]; }
  async getRfq(actor:string,id:string) { return (await this.pool.query('SELECT * FROM public.internal_rfq_get($1,$2)',[actor,id])).rows[0]??null; }
  async getQuote(actor:string,id:string) { return (await this.pool.query('SELECT * FROM public.internal_quote_get($1,$2)',[actor,id])).rows[0]??null; }
  async getNegotiationEvents(actor:string,id:string) { return (await this.pool.query('SELECT * FROM public.internal_negotiation_events($1,$2)',[actor,id])).rows; }
  async getPurchaseCost(actor:string,id:string) { return (await this.pool.query('SELECT * FROM public.internal_purchase_cost_get($1,$2)',[actor,id])).rows[0]??null; }
  async createPricing(actor: string, input: CreatePricingInput) {
    const row = (await this.pool.query<{ id: string }>('SELECT public.internal_pricing_create($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) AS id', [actor, input.caseId ?? null, input.partnerCompanyId, input.currency, JSON.stringify(input.lines), JSON.stringify(input.directCosts ?? []), input.overhead ?? 0, input.overheadReason ?? null, input.correlationId ?? null])).rows[0];
    return { revisionId: row.id };
  }
  async submitPricing(actor: string, revisionId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_pricing_submit($1,$2,$3)', [actor, revisionId, correlationId ?? null]);
  }
  async decidePricing(actor: string, revisionId: string, decision: 'APPROVED' | 'REJECTED', reason?: string, selfApprove = false, correlationId?: string) {
    await this.pool.query('SELECT public.internal_pricing_decide($1,$2,$3,$4,$5,$6)', [actor, revisionId, decision, reason ?? null, selfApprove, correlationId ?? null]);
  }
  async getPricing(actor: string, revisionId: string) { return (await this.pool.query('SELECT * FROM public.internal_pricing_get($1,$2)', [actor, revisionId])).rows[0] ?? null; }
  async getPricingMargin(actor: string, revisionId: string) { return (await this.pool.query('SELECT * FROM public.internal_pricing_margin_get($1,$2)', [actor, revisionId])).rows[0] ?? null; }
  async getPricingOverhead(actor: string, revisionId: string) { return (await this.pool.query('SELECT * FROM public.internal_pricing_overhead_get($1,$2)', [actor, revisionId])).rows[0] ?? null; }
  async createOffer(actor: string, input: { offerId?: string; pricingRevisionId: string; offerReference: string; commercialTerms?: string; paymentTerms?: string; deliveryTerms?: string; correlationId?: string }) {
    const row = (await this.pool.query<{ offer_id: string; revision_id: string }>('SELECT * FROM public.internal_offer_create($1,$2,$3,$4,$5,$6,$7,$8)', [actor, input.offerId ?? null, input.pricingRevisionId, input.offerReference, input.commercialTerms ?? null, input.paymentTerms ?? null, input.deliveryTerms ?? null, input.correlationId ?? null])).rows[0];
    return { offerId: row.offer_id, revisionId: row.revision_id };
  }
  async submitOffer(actor: string, revisionId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_offer_submit($1,$2,$3)', [actor, revisionId, correlationId ?? null]);
  }
  async decideOffer(actor: string, revisionId: string, decision: 'APPROVED' | 'REJECTED', reason?: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_offer_decide($1,$2,$3,$4,$5)', [actor, revisionId, decision, reason ?? null, correlationId ?? null]);
  }
  async issueOffer(actor: string, revisionId: string, validUntil: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_offer_issue($1,$2,$3,$4)', [actor, revisionId, validUntil, correlationId ?? null]);
  }
  async withdrawOffer(actor: string, revisionId: string, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_offer_withdraw($1,$2,$3,$4)', [actor, revisionId, reason, correlationId ?? null]);
  }
  async getOfferBinding(actor: string, revisionId: string) {
    return (await this.pool.query<{ pricing_revision_id: string }>('SELECT * FROM public.internal_offer_binding_get($1,$2)', [actor, revisionId])).rows[0] ?? null;
  }
  async verifyPartnerPurchaseOrder(actor: string, purchaseOrderId: string, reason?: string, correlationId?: string) {
    return (await this.pool.query<{ verification_id: string; outcome: string }>('SELECT * FROM public.internal_partner_po_verify($1,$2,$3,$4)', [actor, purchaseOrderId, reason ?? null, correlationId ?? null])).rows[0];
  }
  async createCommercialCommitment(actor: string, purchaseOrderId: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_commercial_commitment_create($1,$2,$3) AS id', [actor, purchaseOrderId, correlationId ?? null])).rows[0].id;
  }
  async createPaymentRequirement(actor: string, commitmentId: string, input: { type: string; amount: number; currency: string; dueDate?: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_payment_requirement_create($1,$2,$3,$4,$5,$6,$7) AS id', [actor, commitmentId, input.type, input.amount, input.currency, input.dueDate ?? null, input.correlationId ?? null])).rows[0].id;
  }
  async verifyPayment(actor: string, receiptId: string, method: 'DOCUMENT_EVIDENCE' | 'INTERNAL_CONFIRMATION', reason: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_payment_verify($1,$2,$3,$4,$5) AS id', [actor, receiptId, method, reason, correlationId ?? null])).rows[0].id;
  }
  async createSupplierFundingRequirement(actor: string, commitmentId: string, input: { stage: string; amount: number; currency: string; requiredBy?: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_funding_create($1,$2,$3,$4,$5,$6,$7) AS id', [actor, commitmentId, input.stage, input.amount, input.currency, input.requiredBy ?? null, input.correlationId ?? null])).rows[0].id;
  }
  async authorizeInternalFunding(actor: string, requirementId: string, input: { amount: number; currency: string; reason: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_funding_authorize($1,$2,$3,$4,$5,$6) AS id', [actor, requirementId, input.amount, input.currency, input.reason, input.correlationId ?? null])).rows[0].id;
  }
  async evaluateFunding(actor: string, requirementId: string, correlationId?: string) {
    return (await this.pool.query<{ evaluation_id: string; status: string; funding_gap: string | null }>('SELECT * FROM public.internal_cash_funding_evaluate($1,$2,$3)', [actor, requirementId, correlationId ?? null])).rows[0];
  }
  async getSupplierFunding(actor: string, requirementId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_funding_get($1,$2)', [actor, requirementId])).rows[0] ?? null;
  }
  async getCashExposure(actor: string, requirementId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_cash_exposure_get($1,$2)', [actor, requirementId])).rows;
  }
  async createSupplierReconfirmation(actor: string, input: { purchaseSourceId: string; supplierCompanyId: string; productIdentityId: string; price: number; currency: string; quantity: number; validUntil?: string; note?: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_reconfirmation_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id', [actor, input.purchaseSourceId, input.supplierCompanyId, input.productIdentityId, input.price, input.currency, input.quantity, input.validUntil ?? null, input.note ?? null, input.correlationId ?? null])).rows[0].id;
  }
  async executeProcurementRelease(actor: string, commitmentId: string, lines: Array<{ commercialCommitmentLineId: string; productIdentityId: string; quantity: number; unitId: string; approvedPurchaseCostSnapshotId: string; supplierReconfirmationId?: string }>, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_procurement_release_execute($1,$2,$3::jsonb,$4) AS id', [actor, commitmentId, JSON.stringify(lines), correlationId ?? null])).rows[0].id;
  }
  async withdrawProcurementRelease(actor: string, releaseId: string, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_procurement_release_withdraw($1,$2,$3,$4)', [actor, releaseId, reason, correlationId ?? null]);
  }
  async createSupplierPurchaseOrderDraft(actor: string, purchaseSourceId: string, currency: string, lines: Array<Record<string, unknown>>, leadProcurementEngineerId?: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_po_draft_create($1,$2,$3,$4::jsonb,$5,$6) AS id', [actor, purchaseSourceId, currency, JSON.stringify(lines), leadProcurementEngineerId ?? null, correlationId ?? null])).rows[0].id;
  }
  async issueSupplierPurchaseOrder(actor: string, purchaseOrderId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_issue($1,$2,$3)', [actor, purchaseOrderId, correlationId ?? null]);
  }
  async setPurchaseSourcePreference(actor: string, purchaseSourceId: string, preferred: boolean, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_purchase_source_preference_set($1,$2,$3,$4,$5)', [actor, purchaseSourceId, preferred, reason, correlationId ?? null]);
  }
  async authorizeStrategicOverbuy(actor: string, input: { purchaseSourceId: string; productIdentityId: string; unitId: string; quantity: number; currency: string; maxUnitPurchaseCost: number; reason: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_strategic_overbuy_authorize($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id', [actor, input.purchaseSourceId, input.productIdentityId, input.unitId, input.quantity, input.currency, input.maxUnitPurchaseCost, input.reason, input.correlationId ?? null])).rows[0].id;
  }
  async getScopedSupplierPurchaseOrder(actor: string, purchaseOrderId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_scoped_get($1,$2)', [actor, purchaseOrderId])).rows;
  }
  async listScopedSupplierPurchaseOrders(actor: string, limit = 50, offset = 0) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_scoped_list($1,$2,$3)', [actor, limit, offset])).rows;
  }
  async setSupplierPurchaseOrderLineResponsibility(actor: string, lineId: string, engineerId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_line_responsibility_set($1,$2,$3,$4)', [actor, lineId, engineerId, correlationId ?? null]);
  }
  async setSupplierPurchaseOrderLead(actor: string, purchaseOrderId: string, engineerId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_lead_set($1,$2,$3,$4)', [actor, purchaseOrderId, engineerId, correlationId ?? null]);
  }
  async recordSupplierPOConfirmation(actor: string, lineId: string, quantity: number, promisedDate: string, supplierReference?: string, note?: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_po_confirmation_record($1,$2,$3,$4,$5,$6,$7) AS id', [actor, lineId, quantity, promisedDate, supplierReference ?? null, note ?? null, correlationId ?? null])).rows[0].id;
  }
  async getSupplierPOConfirmationLine(actor: string, lineId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_confirmation_line_get($1,$2)', [actor, lineId])).rows[0] ?? null;
  }
  async changeSupplierPOConfirmationDate(actor: string, lineId: string, previousDate: string, newDate: string, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_confirmation_date_change($1,$2,$3,$4,$5,$6)', [actor, lineId, previousDate, newDate, reason, correlationId ?? null]);
  }
  async correctSupplierPOConfirmationReference(actor: string, lineId: string, previousReference: string, correctedReference: string, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_confirmation_reference_correct($1,$2,$3,$4,$5,$6)', [actor, lineId, previousReference, correctedReference, reason, correlationId ?? null]);
  }
  async getSupplierPOConfirmation(actor: string, purchaseOrderId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_confirmation_po_get($1,$2)', [actor, purchaseOrderId])).rows;
  }
  async createBuyingPowerConversion(actor: string, commitmentLineId: string, sourceType: 'NEED' | 'EXECUTION_ITEM' | 'EXTERNAL', sourceId: string | null, quantity: number, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_buying_power_conversion_create($1,$2,$3,$4,$5,$6) AS id', [actor, commitmentLineId, sourceType, sourceId, quantity, correlationId ?? null])).rows[0].id;
  }
  async runBuyingPowerFoundation(actor: string, horizon: 'WEEKLY_IMMEDIATE' | 'ROLLING_PLANNED', timeBucket: string, requestKey: string, commitmentLineIds: string[], correlationId?: string) {
    const row = (await this.pool.query<{ run_id: string; snapshot_id: string }>('SELECT * FROM public.internal_buying_power_foundation_run($1,$2,$3,$4,$5::uuid[],$6)', [actor, horizon, timeBucket, requestKey, commitmentLineIds, correlationId ?? null])).rows[0];
    return { runId: row.run_id, snapshotId: row.snapshot_id };
  }
  async runBuyingPowerClassification(actor: string, horizon: 'WEEKLY_IMMEDIATE' | 'ROLLING_PLANNED', timeBucket: string, requestKey: string, needIds: string[], commitmentLineIds: string[], correlationId?: string) {
    const row = (await this.pool.query<{ run_id: string; snapshot_id: string }>('SELECT * FROM public.internal_buying_power_classified_run($1,$2,$3,$4,$5::uuid[],$6::uuid[],$7)', [actor, horizon, timeBucket, requestKey, needIds, commitmentLineIds, correlationId ?? null])).rows[0];
    return { runId: row.run_id, snapshotId: row.snapshot_id };
  }
  async getBuyingPowerClassifiedSummary(actor: string, snapshotId: string) { return (await this.pool.query('SELECT * FROM public.internal_buying_power_classified_summary_get($1,$2)', [actor, snapshotId])).rows; }
  async getBuyingPowerInternalSummary(actor: string, snapshotId: string) { return (await this.pool.query('SELECT * FROM public.internal_buying_power_summary_view($1,$2)', [actor, snapshotId])).rows; }
  async getBuyingPowerSummary(actor: string, snapshotId: string) { return (await this.pool.query('SELECT * FROM public.internal_buying_power_snapshot_summary_get($1,$2)', [actor, snapshotId])).rows; }
  async getBuyingPowerInternalLineage(actor: string, snapshotId: string) { return (await this.pool.query('SELECT * FROM public.internal_buying_power_lineage_view($1,$2)', [actor, snapshotId])).rows; }
  async getBuyingPowerLineage(actor: string, snapshotId: string) { return (await this.pool.query('SELECT * FROM public.internal_buying_power_snapshot_lineage_get($1,$2)', [actor, snapshotId])).rows; }
  async registerSupplierPOCommercialDocument(actor: string, purchaseOrderId: string, documentId: string, versionId: string, documentType: string, classification: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_po_commercial_document_register($1,$2,$3,$4,$5,$6,$7) AS id', [actor, purchaseOrderId, documentId, versionId, documentType, classification, correlationId ?? null])).rows[0].id;
  }
  async setSupplierPOCommercialDocumentCoverage(actor: string, documentId: string, lineId: string, quantity: number | null, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_commercial_document_coverage_set($1,$2,$3,$4,$5)', [actor, documentId, lineId, quantity, correlationId ?? null]);
  }
  async getSupplierPOCommercialDocument(actor: string, documentId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_commercial_document_get($1,$2)', [actor, documentId])).rows[0] ?? null;
  }
  async verifySupplierPOCommercialDocument(actor: string, documentId: string, facts: Record<string, unknown>, correlationId?: string) {
    return (await this.pool.query<{ id: string; result: string; mismatch_reasons: string[] }>('SELECT * FROM public.internal_supplier_po_commercial_document_verify($1,$2,$3::jsonb,$4)', [actor, documentId, JSON.stringify(facts), correlationId ?? null])).rows[0];
  }
  async createSupplierPaymentScheduleDraft(actor: string, purchaseOrderId: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_payment_schedule_draft_create($1,$2,$3) AS id', [actor, purchaseOrderId, correlationId ?? null])).rows[0].id;
  }
  async addSupplierPaymentScheduleItem(actor: string, revisionId: string, input: { lineNumber: number; triggerType: string; amount: number | string; percentage?: number | string; fixedDate?: string; milestoneDescription?: string; metadata?: Record<string, unknown> }, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_payment_schedule_item_add($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) AS id', [actor, revisionId, input.lineNumber, input.triggerType, input.amount, input.percentage ?? null, input.fixedDate ?? null, input.milestoneDescription ?? null, JSON.stringify(input.metadata ?? {}), correlationId ?? null])).rows[0].id;
  }
  async updateSupplierPaymentScheduleItem(actor: string, itemId: string, input: { triggerType: string; amount: number | string; percentage?: number | string; fixedDate?: string; milestoneDescription?: string; metadata?: Record<string, unknown> }, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_payment_schedule_item_update($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)', [actor, itemId, input.triggerType, input.amount, input.percentage ?? null, input.fixedDate ?? null, input.milestoneDescription ?? null, JSON.stringify(input.metadata ?? {}), correlationId ?? null]);
  }
  async removeSupplierPaymentScheduleItem(actor: string, itemId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_payment_schedule_item_remove($1,$2,$3)', [actor, itemId, correlationId ?? null]);
  }
  async getSupplierPaymentSchedule(actor: string, revisionId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_payment_schedule_get($1,$2)', [actor, revisionId])).rows[0] ?? null;
  }
  async getSupplierPaymentScheduleItems(actor: string, revisionId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_payment_schedule_items_get($1,$2)', [actor, revisionId])).rows;
  }
  async createPartnerDeliverySite(actor: string, companyId: string, projectId: string | null, label: string, location: Record<string, unknown> = {}, contact: Record<string, unknown> = {}, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_partner_delivery_site_create($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) AS id', [actor, companyId, projectId, label, JSON.stringify(location), JSON.stringify(contact), correlationId ?? null])).rows[0].id;
  }
  async createSupplierPODeliveryTranche(actor: string, allocationId: string, siteId: string, confirmationEventId: string, quantity: number, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_po_delivery_tranche_create($1,$2,$3,$4,$5,$6) AS id', [actor, allocationId, siteId, confirmationEventId, quantity, correlationId ?? null])).rows[0].id;
  }
  async changeSupplierPODeliveryTrancheDate(actor: string, trancheId: string, previousDate: string, newDate: string, reason: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_po_delivery_tranche_date_change($1,$2,$3,$4,$5,$6)', [actor, trancheId, previousDate, newDate, reason, correlationId ?? null]);
  }
  async getSupplierPODeliveryTranche(actor: string, trancheId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_delivery_tranche_get($1,$2)', [actor, trancheId])).rows[0] ?? null;
  }
  async listSupplierPODeliverySchedule(actor: string, purchaseOrderId?: string | null) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_po_delivery_schedule_list($1,$2)', [actor, purchaseOrderId ?? null])).rows;
  }
  async recordSupplierPODelivery(actor: string, trancheId: string, input: { quantity: number; deliveredAt: string; idempotencyKey: string; operationalReference?: string }, correlationId?: string) {
    return (await this.pool.query<{ id: string }>(
      'SELECT public.internal_supplier_po_delivery_execution_record($1,$2,$3,$4,$5,$6,$7) AS id',
      [actor, trancheId, input.quantity, input.deliveredAt, input.operationalReference ?? null, input.idempotencyKey, correlationId ?? null],
    )).rows[0].id;
  }
  async getSupplierPODeliveryExecution(actor: string, trancheId: string) {
    return (await this.pool.query(
      'SELECT * FROM public.internal_supplier_po_delivery_execution_get($1,$2)',
      [actor, trancheId],
    )).rows[0] ?? null;
  }
  async registerWarrantyEntitlement(actor: string, input: { deliveryEventId: string; coveredQuantity: number; startTrigger: 'DELIVERY' | 'RECEIPT' | 'ACCEPTANCE' | 'INSTALLATION' | 'CONTRACTUAL' | 'PROVIDER_DEFINED'; startDate: string; endDate: string; providerType: 'MANUFACTURER' | 'AUTHORIZED_DISTRIBUTOR' | 'SUPPLIER' | 'SCO_CONTRACTUAL' | 'OTHER'; idempotencyKey: string; receiptEventId?: string; acceptanceEventId?: string; startReference?: string; providerCompanyId?: string; providerReference?: string; evidenceDocumentId?: string; evidenceVersionId?: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>(
      'SELECT public.internal_warranty_entitlement_register($1,$2,$3,$4::public."WarrantyStartTrigger",$5,$6,$7,$8,$9,$10::public."WarrantyProviderType",$11,$12,$13,$14,$15,$16) AS id',
      [actor, input.deliveryEventId, input.coveredQuantity, input.startTrigger, input.startDate, input.receiptEventId ?? null, input.acceptanceEventId ?? null, input.startReference ?? null, input.endDate, input.providerType, input.providerCompanyId ?? null, input.providerReference ?? null, input.evidenceDocumentId ?? null, input.evidenceVersionId ?? null, input.idempotencyKey, input.correlationId ?? null],
    )).rows[0].id;
  }
  async getWarrantyEntitlement(actor: string, entitlementId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_warranty_entitlement_get($1,$2)', [actor, entitlementId])).rows[0] ?? null;
  }
  async createSupplierFutureDemandFramework(actor: string, input: { reference: string; supplierCompanyId: string; supplierPartnershipId: string; purchaseSourceId: string; effectiveFrom: string; effectiveUntil: string; scopeLines: Array<{ productIdentityId: string; unitId: string }>; idempotencyKey: string; correlationId?: string }) {
    return (await this.pool.query<{ framework_id: string; revision_id: string }>(
      'SELECT * FROM public.internal_supplier_future_demand_framework_create($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)',
      [actor, input.reference, input.supplierCompanyId, input.supplierPartnershipId, input.purchaseSourceId, input.effectiveFrom, input.effectiveUntil, JSON.stringify(input.scopeLines), input.idempotencyKey, input.correlationId ?? null],
    )).rows[0];
  }
  async createSupplierFutureDemandFrameworkRevision(actor: string, frameworkId: string, input: { effectiveFrom: string; effectiveUntil: string; scopeLines: Array<{ productIdentityId: string; unitId: string }>; idempotencyKey: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>(
      'SELECT public.internal_supplier_future_demand_framework_revision_create($1,$2,$3,$4,$5::jsonb,$6,$7) AS id',
      [actor, frameworkId, input.effectiveFrom, input.effectiveUntil, JSON.stringify(input.scopeLines), input.idempotencyKey, input.correlationId ?? null],
    )).rows[0].id;
  }
  async approveSupplierFutureDemandFramework(actor: string, revisionId: string, idempotencyKey: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_future_demand_framework_approve($1,$2,$3,$4)', [actor, revisionId, idempotencyKey, correlationId ?? null]);
  }
  async offerSupplierFutureDemandFramework(actor: string, revisionId: string, idempotencyKey: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_future_demand_framework_offer($1,$2,$3,$4)', [actor, revisionId, idempotencyKey, correlationId ?? null]);
  }
  async acceptSupplierFutureDemandFramework(actor: string, revisionId: string, input: { idempotencyKey: string; documentId?: string; documentVersionId?: string; reference?: string; correlationId?: string }) {
    await this.pool.query('SELECT public.internal_supplier_future_demand_framework_accept($1,$2,$3,$4,$5,$6,$7)', [actor, revisionId, input.documentId ?? null, input.documentVersionId ?? null, input.reference ?? null, input.idempotencyKey, input.correlationId ?? null]);
  }
  async supersedeSupplierFutureDemandFramework(actor: string, revisionId: string, idempotencyKey: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_future_demand_framework_supersede($1,$2,$3,$4)', [actor, revisionId, idempotencyKey, correlationId ?? null]);
  }
  async terminateSupplierFutureDemandFramework(actor: string, frameworkId: string, reason: string, idempotencyKey: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_future_demand_framework_terminate($1,$2,$3,$4,$5)', [actor, frameworkId, reason, idempotencyKey, correlationId ?? null]);
  }
  async getSupplierFutureDemandFramework(actor: string, frameworkId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_future_demand_framework_get($1,$2)', [actor, frameworkId])).rows;
  }
  async createSupplierFutureDemandFrameworkCommercialTerm(actor: string, revisionId: string, input: { productIdentityId: string; unitId: string; pricingKind: 'FIXED' | 'TIERED'; currencyCode: string; taxTreatment: string; idempotencyKey: string; fixedUnitPurchasePrice?: number; taxReference?: string; tiers?: Array<{ lowerQuantity: number; upperQuantity?: number; unitPurchasePrice: number }>; correlationId?: string }) {
    const tiers = input.tiers?.map((tier) => ({
      lower_quantity: tier.lowerQuantity,
      ...(tier.upperQuantity === undefined ? {} : { upper_quantity: tier.upperQuantity }),
      unit_purchase_price: tier.unitPurchasePrice,
    }));
    return (await this.pool.query<{ id: string }>(
      'SELECT public.internal_supplier_future_demand_framework_commercial_term_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) AS id',
      [actor, revisionId, input.productIdentityId, input.unitId, input.pricingKind, input.fixedUnitPurchasePrice ?? null, input.currencyCode, input.taxTreatment, input.taxReference ?? null, tiers === undefined ? null : JSON.stringify(tiers), input.idempotencyKey, input.correlationId ?? null],
    )).rows[0].id;
  }
  async createSupplierFutureDemandFrameworkCapacityPeriod(actor: string, revisionId: string, input: { productIdentityId: string; unitId: string; periodStart: string; periodEnd: string; indicativeQuantity: number; idempotencyKey: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>(
      'SELECT public.internal_supplier_future_demand_framework_capacity_period_create($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id',
      [actor, revisionId, input.productIdentityId, input.unitId, input.periodStart, input.periodEnd, input.indicativeQuantity, input.idempotencyKey, input.correlationId ?? null],
    )).rows[0].id;
  }
  async attachSupplierFutureDemandFrameworkBuyingPowerProvenance(actor: string, revisionId: string, input: { snapshotId: string; snapshotLineId: string; signalClass: 'QUALIFIED' | 'COMMITTED'; idempotencyKey: string; correlationId?: string }) {
    return (await this.pool.query<{ id: string }>(
      'SELECT public.internal_supplier_future_demand_framework_buying_power_provenance_attach($1,$2,$3,$4,$5,$6,$7) AS id',
      [actor, revisionId, input.snapshotId, input.snapshotLineId, input.signalClass, input.idempotencyKey, input.correlationId ?? null],
    )).rows[0].id;
  }
  async getSupplierFutureDemandFrameworkCommercialTerms(actor: string, revisionId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_future_demand_framework_commercial_terms_get($1,$2)', [actor, revisionId])).rows;
  }
  async getSupplierFutureDemandFrameworkCapacityPeriods(actor: string, revisionId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_future_demand_framework_capacity_periods_get($1,$2)', [actor, revisionId])).rows;
  }
  async getSupplierFutureDemandFrameworkBuyingPowerProvenance(actor: string, revisionId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_future_demand_framework_buying_power_provenance_get($1,$2)', [actor, revisionId])).rows;
  }
  async approveSupplierPaymentSchedule(actor: string, revisionId: string, reason?: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_supplier_payment_schedule_approve($1,$2,$3,$4)', [actor, revisionId, reason ?? null, correlationId ?? null]);
  }
  async createSupplierPaymentScheduleRevision(actor: string, revisionId: string, correlationId?: string) {
    return (await this.pool.query<{ id: string }>('SELECT public.internal_supplier_payment_schedule_revision_create($1,$2,$3) AS id', [actor, revisionId, correlationId ?? null])).rows[0].id;
  }

  // SR-01 remediation: typed gateways replacing sco_runtime direct DML gated only by app.sco_internal.
  async catalogCategoryCreate(actor: string, code: string, name: string, parentId?: string) {
    return (await this.pool.query('SELECT * FROM public.internal_catalog_category_create($1,$2,$3,$4)', [actor, code, name, parentId ?? null])).rows[0];
  }
  async catalogAttributeCreate(actor: string, categoryId: string, input: { key: string; displayName: string; dataType: string; required?: boolean; unitApplicability?: unknown; validationMetadata?: unknown }) {
    return (await this.pool.query('SELECT * FROM public.internal_catalog_attribute_create($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)', [actor, categoryId, input.key, input.displayName, input.dataType, input.required ?? false, JSON.stringify(input.unitApplicability ?? null), JSON.stringify(input.validationMetadata ?? null)])).rows[0];
  }
  async catalogProductCreate(actor: string, input: { categoryId: string; brand?: string; manufacturer?: string; modelReference?: string; publicSpecification?: unknown; unitId?: string; warrantyType?: string; warrantyPeriodMonths?: number; warrantyProvider?: string }) {
    return (await this.pool.query('SELECT * FROM public.internal_catalog_product_create($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)', [actor, input.categoryId, input.brand ?? null, input.manufacturer ?? null, input.modelReference ?? null, JSON.stringify(input.publicSpecification ?? null), input.unitId ?? null, input.warrantyType ?? null, input.warrantyPeriodMonths ?? null, input.warrantyProvider ?? null])).rows[0];
  }
  async catalogProductActivate(actor: string, id: string) {
    return (await this.pool.query('SELECT * FROM public.internal_catalog_product_activate($1,$2)', [actor, id])).rows[0] ?? null;
  }
  async candidateSubmitInternal(actor: string, input: { submittedName: string; requestedCategoryId?: string; brand?: string; manufacturer?: string; modelReference?: string; submittedSpecification?: unknown; unitId?: string }) {
    return (await this.pool.query('SELECT * FROM public.internal_candidate_submit($1,$2,$3,$4,$5,$6,$7::jsonb,$8)', [actor, input.submittedName, input.requestedCategoryId ?? null, input.brand ?? null, input.manufacturer ?? null, input.modelReference ?? null, JSON.stringify(input.submittedSpecification ?? null), input.unitId ?? null])).rows[0];
  }
  async candidateTransition(actor: string, id: string, toStatus: string, reason?: string, assessment?: { productIdentityId?: string; explanation?: string; matchedAttributes?: unknown; differingAttributes?: unknown; missingAttributes?: unknown }) {
    return (await this.pool.query('SELECT * FROM public.internal_candidate_transition($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)', [actor, id, toStatus, reason ?? null, assessment?.productIdentityId ?? null, assessment?.explanation ?? null, JSON.stringify(assessment?.matchedAttributes ?? null), JSON.stringify(assessment?.differingAttributes ?? null), JSON.stringify(assessment?.missingAttributes ?? null)])).rows[0];
  }
  async qualificationCreate(actor: string, legalName: string, contactEmail: string) {
    return (await this.pool.query('SELECT * FROM public.internal_qualification_create($1,$2,$3)', [actor, legalName, contactEmail])).rows[0];
  }
  async qualificationCreateForCompany(actor: string, companyId: string, legalName: string, contactEmail: string) {
    return (await this.pool.query('SELECT * FROM public.internal_qualification_create_for_company($1,$2,$3,$4)', [actor, companyId, legalName, contactEmail])).rows[0];
  }
  async qualificationDecide(actor: string, id: string, status: 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED', reason?: string) {
    if (status === 'UNDER_REVIEW' || status === 'ACTION_REQUIRED') {
      return (await this.pool.query('SELECT * FROM public.internal_qualification_transition($1,$2,$3,$4,$5)', [actor, id, status, reason ?? null, null])).rows[0] ?? null;
    }
    return (await this.pool.query('SELECT * FROM public.internal_qualification_decide($1,$2,$3,$4)', [actor, id, status, reason ?? null])).rows[0] ?? null;
  }
  async qualificationList(actor: string) {
    return (await this.pool.query('SELECT * FROM public.internal_qualification_list($1)', [actor])).rows;
  }
  async documentList(actor: string, limit: number, offset: number) {
    return (await this.pool.query('SELECT * FROM public.internal_document_list($1,$2,$3)', [actor, limit, offset])).rows;
  }
  async verifyQueue(actor: string, limit: number, offset: number, status?: string) {
    return (await this.pool.query('SELECT * FROM public.internal_verify_queue($1,$2,$3,$4)', [actor, limit, offset, status ?? null])).rows;
  }
  async prepareOperationalVerifyResult(actor: string, input: {
    runId: string; offerValue?: unknown; verifiedReferenceScope?: unknown; gap?: unknown; confidence?: unknown;
    proposedAction: string; exclusions?: unknown; supersedesResultId?: string; correlationId?: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
      const result = await client.query<{ id: string }>(
        'SELECT public.internal_verify_result_prepare_operational($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,$10) AS id',
        [actor, input.runId, JSON.stringify(input.offerValue ?? {}), JSON.stringify(input.verifiedReferenceScope ?? {}), JSON.stringify(input.gap ?? {}), JSON.stringify(input.confidence ?? {}), input.proposedAction, JSON.stringify(input.exclusions ?? {}), input.supersedesResultId ?? null, input.correlationId ?? null],
      );
      await client.query('COMMIT');
      return result.rows[0]?.id ?? null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async finalizeVerifyResult(actor: string, resultId: string, correlationId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
      await client.query('SELECT public.internal_verify_result_finalize($1,$2,$3)', [actor, resultId, correlationId ?? null]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async partnershipCreate(actor: string, companyId: string, type: 'BUYER_PARTNERSHIP' | 'SUPPLIER_PARTNERSHIP') {
    return (await this.pool.query('SELECT * FROM public.internal_partnership_create($1,$2,$3)', [actor, companyId, type])).rows[0] ?? null;
  }
  async partnershipActionQueue(actor: string): Promise<InternalPartnershipReadiness[]> {
    const result = await this.pool.query<InternalPartnershipReadinessRow>(
      'SELECT * FROM public.internal_partnership_action_queue($1)',
      [actor],
    );
    return result.rows.map(mapInternalPartnershipReadiness);
  }
  async partnershipReadinessGet(actor: string, partnershipId: string): Promise<InternalPartnershipReadiness | null> {
    const result = await this.pool.query<InternalPartnershipReadinessRow>(
      'SELECT * FROM public.internal_partnership_readiness_get($1,$2)',
      [actor, partnershipId],
    );
    return result.rows[0] ? mapInternalPartnershipReadiness(result.rows[0]) : null;
  }
  async partnershipActivate(actor: string, id: string) {
    return (await this.pool.query('SELECT * FROM public.internal_partnership_activate($1,$2)', [actor, id])).rows[0] ?? null;
  }
  async partnershipApprove(actor: string, id: string, reason: string, correlationId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_partnership_approve($1,$2,$3,$4)', [actor, id, reason, correlationId])).rows[0] ?? null;
  }
  async partnershipSuspend(actor: string, id: string, reason: string, correlationId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_partnership_suspend($1,$2,$3,$4)', [actor, id, reason, correlationId])).rows[0] ?? null;
  }
  async partnershipRevoke(actor: string, id: string, reason: string, correlationId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_partnership_revoke($1,$2,$3,$4)', [actor, id, reason, correlationId])).rows[0] ?? null;
  }
  async partnershipReject(actor: string, id: string, reason: string, correlationId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_partnership_reject($1,$2,$3,$4)', [actor, id, reason, correlationId])).rows[0] ?? null;
  }
  async agreementPolicyCreate(actor: string, input: {
    agreementType: string; versionCode: string; contentText: string; effectiveAt: string;
    acceptancePermissionCode: string; reacceptanceRequired: boolean; suspensionEffect: string;
    terminationEffect: string; retentionClassification: string; required: boolean; correlationId: string;
  }) {
    return (await this.pool.query(
      'SELECT * FROM public.internal_partner_agreement_policy_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [actor, input.agreementType, input.versionCode, input.contentText, input.effectiveAt, input.acceptancePermissionCode,
        input.reacceptanceRequired, input.suspensionEffect, input.terminationEffect, input.retentionClassification, input.required, input.correlationId],
    )).rows[0];
  }
  async agreementPolicyPublish(actor: string, id: string, correlationId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_partner_agreement_policy_publish($1,$2,$3)', [actor, id, correlationId])).rows[0] ?? null;
  }
  async agreementPolicyTransition(actor: string, id: string, state: 'SUSPENDED' | 'TERMINATED', reason: string, correlationId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_partner_agreement_policy_transition($1,$2,$3,$4,$5)', [actor, id, state, reason, correlationId])).rows[0] ?? null;
  }
  async executionCycleCreate(actor: string, input: { code: string; name: string; opensAt: string; closesAt: string }) {
    return (await this.pool.query('SELECT * FROM public.internal_execution_cycle_create($1,$2,$3,$4,$5)', [actor, input.code, input.name, input.opensAt, input.closesAt])).rows[0];
  }
  async executionAssign(actor: string, cycleId: string, needId: string, quantity: number, key: string) {
    return (await this.pool.query('SELECT * FROM public.internal_execution_assign($1,$2,$3,$4,$5)', [actor, cycleId, needId, quantity, key])).rows[0];
  }
  async supplierEligibleSources(actor: string, executionItemId: string) {
    return (await this.pool.query('SELECT * FROM public.internal_supplier_eligible_sources($1,$2)', [actor, executionItemId])).rows;
  }
  async supplierQualificationDecide(actor: string, qualificationId: string, status: string, reason?: string) {
    const result = await this.pool.query('SELECT * FROM public.internal_supplier_qualification_decide($1,$2,$3,$4)', [actor, qualificationId, status, reason ?? null]);
    if (!result.rowCount) throw new Error('SUPPLIER_QUALIFICATION_NOT_FOUND');
    return result.rows[0];
  }
  async purchaseSourceCreate(actor: string, input: { supplierCompanyId: string; supplierPartnershipId: string; sourceCode: string; sourceTypeId: string; branchContext?: string; commercialRoute?: string; operationalContext?: string }) {
    return (await this.pool.query('SELECT * FROM public.internal_purchase_source_create($1,$2,$3,$4,$5,$6,$7,$8)', [actor, input.supplierCompanyId, input.supplierPartnershipId, input.sourceCode, input.sourceTypeId, input.branchContext ?? null, input.commercialRoute ?? null, input.operationalContext ?? null])).rows[0];
  }
}
