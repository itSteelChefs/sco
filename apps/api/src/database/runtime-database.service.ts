import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { MetricsService } from '../observability/metrics.service.js';
import { createObservedPool } from './observed-pool.js';

@Injectable()
export class RuntimeDatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Optional() @Inject(MetricsService) metrics?: MetricsService) {
    this.pool = createObservedPool(process.env.RUNTIME_DATABASE_URL, 'runtime', metrics);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

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

  async withActor<T>(actorUserId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.actor_id', $1, true)", [actorUserId]);
      return callback(client);
    });
  }

  async currentRole(): Promise<string> {
    const result = await this.pool.query<{ current_user: string }>('SELECT current_user');
    return result.rows[0].current_user;
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  poolStats() {
    return { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount };
  }

  async submitPartnerPurchaseOrder(actor: string, companyId: string, input: {
    offerId: string;
    offerRevisionId: string;
    reference: string;
    poDate: string;
    currency: string;
    totalExclTax: number;
    taxAmount: number;
    totalInclTax: number;
    paymentTerms?: string;
    deliveryTerms?: string;
    administrativeMetadata?: Record<string, unknown>;
    lines: Array<Record<string, unknown>>;
    correlationId?: string;
  }) {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      const result = await client.query<{ id: string }>('SELECT public.partner_po_submit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15) AS id', [actor, companyId, input.offerId, input.offerRevisionId, input.reference, input.poDate, input.currency, input.totalExclTax, input.taxAmount, input.totalInclTax, input.paymentTerms ?? null, input.deliveryTerms ?? null, JSON.stringify(input.administrativeMetadata ?? {}), JSON.stringify(input.lines), input.correlationId ?? null]);
      return result.rows[0].id;
    });
  }

  async getPartnerPurchaseOrder(actor: string, companyId: string, purchaseOrderId: string) {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query<{ projection: Record<string, unknown> | null }>('SELECT public.partner_purchase_order_projection($1,$2,$3) AS projection', [actor, companyId, purchaseOrderId])).rows[0].projection;
    });
  }

  async getCommercialCommitment(actor: string, companyId: string, commitmentId: string) {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query<{ projection: Record<string, unknown> | null }>('SELECT public.commercial_commitment_projection($1,$2,$3) AS projection', [actor, companyId, commitmentId])).rows[0].projection;
    });
  }

  async getPartnerDeliveryProjection(actor: string, companyId: string, commitmentId?: string | null) {
    return this.withActor(actor, async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query('SELECT * FROM public.partner_delivery_projection_list($1,$2,$3)', [actor, companyId, commitmentId ?? null])).rows;
    });
  }

  async confirmPartnerDeliveryReceipt(actor: string, companyId: string, input: { deliveryEventId: string; quantity: number; receivedAt: string; idempotencyKey: string; operationalNote?: string; correlationId?: string }) {
    return this.withActor(actor, async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query<{ id: string }>('SELECT public.partner_delivery_receipt_confirm($1,$2,$3,$4,$5,$6,$7,$8) AS id', [actor, companyId, input.deliveryEventId, input.quantity, input.receivedAt, input.operationalNote ?? null, input.idempotencyKey, input.correlationId ?? null])).rows[0].id;
    });
  }

  async confirmPartnerDeliveryAcceptance(actor: string, companyId: string, input: { deliveryEventId: string; quantity: number; acceptedAt: string; idempotencyKey: string; correlationId?: string }) {
    return this.withActor(actor, async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query<{ id: string }>('SELECT public.partner_delivery_acceptance_confirm($1,$2,$3,$4,$5,$6,$7) AS id', [actor, companyId, input.deliveryEventId, input.quantity, input.acceptedAt, input.idempotencyKey, input.correlationId ?? null])).rows[0].id;
    });
  }

  async recordPartnerDeliveryDiscrepancy(actor: string, companyId: string, input: { deliveryEventId: string; quantity: number; reasonCode: string; idempotencyKey: string; receiptEventId?: string; acceptanceEventId?: string; note?: string; correlationId?: string }) {
    return this.withActor(actor, async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query<{ id: string }>('SELECT public.partner_delivery_discrepancy_record($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id', [actor, companyId, input.deliveryEventId, input.receiptEventId ?? null, input.acceptanceEventId ?? null, input.quantity, input.reasonCode, input.note ?? null, input.idempotencyKey, input.correlationId ?? null])).rows[0].id;
    });
  }

  async getSupplierDeliveryDisclosure(actor: string, companyId: string, trancheId: string) {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query('SELECT * FROM public.supplier_delivery_disclosure_projection($1,$2)', [actor, trancheId])).rows[0] ?? null;
    });
  }

  async getPartnerWarrantyEntitlements(actor: string, companyId: string) {
    return this.withActor(actor, async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query('SELECT * FROM public.partner_warranty_entitlement_list($1,$2)', [actor, companyId])).rows;
    });
  }

  async getPartnerWarrantyEntitlementEvidence(actor: string, companyId: string, entitlementId: string) {
    return this.withActor(actor, async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query('SELECT * FROM public.partner_warranty_entitlement_evidence_list($1,$2,$3)', [actor, companyId, entitlementId])).rows;
    });
  }

  async recordPaymentReceipt(actor: string, companyId: string, input: { requirementId: string; amount: number; currency: string; paymentDate: string; method?: string; reference?: string; evidenceReference?: string; idempotencyKey?: string; correlationId?: string }) {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query<{ id: string }>('SELECT public.partner_payment_receipt_record($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS id', [actor, companyId, input.requirementId, input.amount, input.currency, input.paymentDate, input.method ?? null, input.reference ?? null, input.evidenceReference ?? null, input.idempotencyKey ?? null, input.correlationId ?? null])).rows[0].id;
    });
  }

  async getPaymentSummary(actor: string, companyId: string, commitmentId: string) {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query<{ summary: Record<string, unknown> | null }>('SELECT public.partner_payment_summary($1,$2,$3) AS summary', [actor, companyId, commitmentId])).rows[0].summary;
    });
  }

  async getPartnerBuyingPowerOwnContext(actor: string, companyId: string, horizon?: string, bucket?: string) {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [companyId]);
      return (await client.query('SELECT * FROM public.partner_buying_power_own_context($1,$2,$3,$4)', [actor, companyId, horizon ?? null, bucket ?? null])).rows;
    });
  }

  async query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
    return this.pool.query<T>(sql, values);
  }
}
