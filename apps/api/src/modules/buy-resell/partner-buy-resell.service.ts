import { Inject, Injectable } from '@nestjs/common';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';
import { withCommercialErrors } from './buy-resell.errors.js';

@Injectable()
export class PartnerBuyResellService {
  constructor(@Inject(RuntimeDatabaseService) private readonly runtime: RuntimeDatabaseService) {}

  list(actorUserId: string, companyId: string) {
    return withCommercialErrors(async () => {
      return this.runtime.withTransaction(async (client) => {
        await client.query("SELECT set_config('app.actor_id',$1,true), set_config('app.tenant_id',$2,true)", [
          actorUserId,
          companyId,
        ]);
        const rows = await client.query(
          `SELECT * FROM public.partner_commercial_order_list($1,$2)`,
          [actorUserId, companyId],
        );
        return rows.rows.map((row) => ({
          id: row.id,
          orderReference: row.order_reference,
          status: row.status,
          currencyCode: row.currency_code,
          saleTotal: row.sale_total,
          paymentTerms: row.payment_terms,
          fulfillmentReady: row.fulfillment_ready,
          supplierAliasLabel: row.supplier_alias_label,
          confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
          createdAt: new Date(row.created_at).toISOString(),
        }));
      });
    });
  }

  get(actorUserId: string, companyId: string, orderId: string) {
    return withCommercialErrors(async () => {
      return this.runtime.withTransaction(async (client) => {
        await client.query("SELECT set_config('app.actor_id',$1,true), set_config('app.tenant_id',$2,true)", [
          actorUserId,
          companyId,
        ]);
        const result = await client.query<{ partner_commercial_order_get: Record<string, unknown> }>(
          `SELECT public.partner_commercial_order_get($1,$2,$3) AS partner_commercial_order_get`,
          [actorUserId, companyId, orderId],
        );
        return result.rows[0].partner_commercial_order_get;
      });
    });
  }
}
