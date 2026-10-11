import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ScoInternalTransactionService } from '../../database/sco-internal-transaction.service.js';
import { withGIntelligenceErrors } from './g-intelligence.errors.js';
import type {
  GBackfillDto,
  GDemandQueryDto,
  GEvidenceQueryDto,
  GPriceHistoryQueryDto,
} from './g-intelligence.dto.js';

@Injectable()
export class InternalGIntelligenceService {
  constructor(@Inject(ScoInternalTransactionService) private readonly internal: ScoInternalTransactionService) {}

  backfill(actorUserId: string, body: GBackfillDto) {
    return withGIntelligenceErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ internal_g_intelligence_backfill: Record<string, unknown> }>(
          `SELECT public.internal_g_intelligence_backfill($1,$2,$3) AS internal_g_intelligence_backfill`,
          [actorUserId, body.dryRun ?? false, randomUUID()],
        );
        return result.rows[0].internal_g_intelligence_backfill;
      });
    });
  }

  priceHistory(actorUserId: string, query: GPriceHistoryQueryDto) {
    return withGIntelligenceErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ internal_g_price_history: Record<string, unknown> }>(
          `SELECT public.internal_g_price_history($1,$2,$3,$4,$5,$6,$7,$8) AS internal_g_price_history`,
          [
            actorUserId,
            query.comparableKey ?? null,
            query.sector ?? null,
            query.supplierCompanyId ?? null,
            query.from ?? null,
            query.to ?? null,
            query.currencyCode ?? null,
            query.unitId ?? null,
          ],
        );
        return result.rows[0].internal_g_price_history;
      });
    });
  }

  quoteBenchmark(actorUserId: string, quoteLineId: string) {
    return withGIntelligenceErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ internal_g_quote_benchmark: Record<string, unknown> }>(
          `SELECT public.internal_g_quote_benchmark($1,$2) AS internal_g_quote_benchmark`,
          [actorUserId, quoteLineId],
        );
        return result.rows[0].internal_g_quote_benchmark;
      });
    });
  }

  supplierPerformance(actorUserId: string, supplierCompanyId: string) {
    return withGIntelligenceErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ internal_g_supplier_performance: Record<string, unknown> }>(
          `SELECT public.internal_g_supplier_performance($1,$2) AS internal_g_supplier_performance`,
          [actorUserId, supplierCompanyId],
        );
        return result.rows[0].internal_g_supplier_performance;
      });
    });
  }

  category(actorUserId: string, sector: string) {
    return withGIntelligenceErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ internal_g_category_intelligence: Record<string, unknown> }>(
          `SELECT public.internal_g_category_intelligence($1,$2) AS internal_g_category_intelligence`,
          [actorUserId, sector],
        );
        return result.rows[0].internal_g_category_intelligence;
      });
    });
  }

  demand(actorUserId: string, query: GDemandQueryDto) {
    return withGIntelligenceErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ internal_g_demand_signals: Record<string, unknown> }>(
          `SELECT public.internal_g_demand_signals($1,$2,$3) AS internal_g_demand_signals`,
          [actorUserId, query.sector ?? null, query.windowDays ?? 90],
        );
        return result.rows[0].internal_g_demand_signals;
      });
    });
  }

  decisionSupport(actorUserId: string, quoteLineId: string) {
    return withGIntelligenceErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ internal_g_decision_support: Record<string, unknown> }>(
          `SELECT public.internal_g_decision_support($1,$2) AS internal_g_decision_support`,
          [actorUserId, quoteLineId],
        );
        return result.rows[0].internal_g_decision_support;
      });
    });
  }

  evidence(actorUserId: string, query: GEvidenceQueryDto) {
    return withGIntelligenceErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ internal_g_evidence_list: Record<string, unknown> }>(
          `SELECT public.internal_g_evidence_list($1,$2,$3,$4,$5) AS internal_g_evidence_list`,
          [
            actorUserId,
            query.comparableKey ?? null,
            query.factKind ?? null,
            query.limit ?? 50,
            query.offset ?? 0,
          ],
        );
        return result.rows[0].internal_g_evidence_list;
      });
    });
  }
}
