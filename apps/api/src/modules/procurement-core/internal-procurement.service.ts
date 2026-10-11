import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ScoInternalTransactionService } from '../../database/sco-internal-transaction.service.js';
import { withProcurementErrors } from './procurement-core.errors.js';
import type {
  InternalAssessmentDto,
  InternalQuoteRecordDto,
  InternalSelectionDto,
  InternalSupplierEnsureDto,
  InternalProcurementTransitionDto,
} from './internal-procurement.dto.js';

@Injectable()
export class InternalProcurementService {
  constructor(@Inject(ScoInternalTransactionService) private readonly internal: ScoInternalTransactionService) {}

  listSubmitted(actorUserId: string) {
    return withProcurementErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        if (!(await client.query<{ ok: boolean }>('SELECT public.internal_procurement_review_allowed($1) AS ok', [actorUserId])).rows[0].ok) {
          throw new Error('PROCUREMENT_REVIEW_FORBIDDEN');
        }
        const rows = await client.query(
          `SELECT id, company_id, title, sector, status, submitted_at, updated_at
             FROM public.procurement_requirements
            WHERE status <> 'DRAFT'
            ORDER BY updated_at DESC
            LIMIT 200`,
        );
        return rows.rows.map((row) => ({
          id: row.id,
          companyId: row.company_id,
          title: row.title,
          sector: row.sector,
          status: row.status,
          submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
          updatedAt: new Date(row.updated_at).toISOString(),
        }));
      });
    });
  }

  get(actorUserId: string, id: string) {
    return withProcurementErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        if (!(await client.query<{ ok: boolean }>('SELECT public.internal_procurement_review_allowed($1) AS ok', [actorUserId])).rows[0].ok) {
          throw new Error('PROCUREMENT_REVIEW_FORBIDDEN');
        }
        const req = await client.query(`SELECT * FROM public.procurement_requirements WHERE id=$1`, [id]);
        const row = req.rows[0];
        if (!row) throw new Error('PROCUREMENT_REQUIREMENT_NOT_FOUND');
        const lines = await client.query(
          `SELECT * FROM public.procurement_requirement_lines WHERE requirement_id=$1 ORDER BY sort_order, created_at`,
          [id],
        );
        const quotes = await client.query(
          `SELECT id, supplier_company_id, quote_reference, currency_code, status, received_at
             FROM public.procurement_requirement_quotes WHERE requirement_id=$1 ORDER BY received_at`,
          [id],
        );
        return {
          id: row.id,
          companyId: row.company_id,
          title: row.title,
          sector: row.sector,
          status: row.status,
          deliveryLocation: row.delivery_location,
          lines: lines.rows.map((line) => ({
            id: line.id,
            lineKey: line.line_key,
            description: line.description,
            quantity: line.quantity,
            unitId: line.unit_id,
          })),
          quotes: quotes.rows.map((quote) => ({
            id: quote.id,
            supplierCompanyId: quote.supplier_company_id,
            quoteReference: quote.quote_reference,
            currencyCode: quote.currency_code,
            status: quote.status,
            receivedAt: new Date(quote.received_at).toISOString(),
          })),
        };
      });
    });
  }

  transition(actorUserId: string, id: string, body: InternalProcurementTransitionDto) {
    return withProcurementErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_procurement_requirement_transition($1,$2,$3,$4,$5)`, [
          actorUserId,
          id,
          body.nextStatus,
          body.reason ?? null,
          randomUUID(),
        ]),
      );
      return this.get(actorUserId, id);
    });
  }

  listSuppliers(actorUserId: string) {
    return withProcurementErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        const rows = await client.query(`SELECT * FROM public.internal_procurement_supplier_list($1)`, [actorUserId]);
        return rows.rows.map((row) => ({ id: row.id, name: row.name, status: row.status }));
      });
    });
  }

  ensureSupplier(actorUserId: string, body: InternalSupplierEnsureDto) {
    return withProcurementErrors(async () => {
      const id = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_procurement_supplier_ensure($1,$2,$3) AS id`,
          [actorUserId, body.name, randomUUID()],
        );
        return result.rows[0].id;
      });
      return { id, name: body.name, status: 'ACTIVE' };
    });
  }

  recordQuote(actorUserId: string, requirementId: string, body: InternalQuoteRecordDto) {
    return withProcurementErrors(async () => {
      const quoteId = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_procurement_quote_record($1,$2,$3,$4,$5,$6::date,$7,$8,$9::jsonb,$10) AS id`,
          [
            actorUserId,
            requirementId,
            body.supplierCompanyId,
            body.quoteReference,
            body.currencyCode,
            body.validUntil ?? null,
            body.commercialTerms ?? null,
            body.documentId ?? null,
            JSON.stringify(body.lines),
            randomUUID(),
          ],
        );
        return result.rows[0].id;
      });
      return { quoteId, requirementId };
    });
  }

  generateComparison(actorUserId: string, requirementId: string) {
    return withProcurementErrors(async () => {
      const comparisonId = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_procurement_comparison_generate($1,$2,$3) AS id`,
          [actorUserId, requirementId, randomUUID()],
        );
        return result.rows[0].id;
      });
      return this.getComparisonInternal(actorUserId, requirementId, comparisonId);
    });
  }

  assess(actorUserId: string, comparisonId: string, body: InternalAssessmentDto) {
    return withProcurementErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_procurement_assessment_set($1,$2,$3,$4,$5,$6,$7,$8)`, [
          actorUserId,
          comparisonId,
          body.requirementLineId,
          body.quoteId,
          body.technicalState,
          body.technicalNotes ?? null,
          body.commercialNotes ?? null,
          randomUUID(),
        ]),
      );
      return { comparisonId, ok: true };
    });
  }

  select(actorUserId: string, requirementId: string, body: InternalSelectionDto) {
    return withProcurementErrors(async () => {
      const selectionId = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_procurement_selection_set($1,$2,$3,$4,$5) AS id`,
          [actorUserId, requirementId, body.quoteId, body.rationale, randomUUID()],
        );
        return result.rows[0].id;
      });
      // Explicit E boundary — D never creates purchase orders or E side effects.
      return {
        selectionId,
        requirementId,
        quoteId: body.quoteId,
        purchaseOrderCreated: false,
        eSideEffects: 0,
      };
    });
  }

  private getComparisonInternal(actorUserId: string, requirementId: string, comparisonId: string) {
    return this.internal.withScope(actorUserId, async (client) => {
      const entries = await client.query(
        `SELECT alias_label, quote_id, supplier_company_id, coverage_line_count, requirement_line_count,
                coverage_percent, comparable_total, currency_code
           FROM public.procurement_comparison_entries WHERE comparison_id=$1 ORDER BY alias_label`,
        [comparisonId],
      );
      return {
        comparisonId,
        requirementId,
        entries: entries.rows.map((row) => ({
          aliasLabel: row.alias_label,
          quoteId: row.quote_id,
          supplierCompanyId: row.supplier_company_id,
          coverageLineCount: row.coverage_line_count,
          requirementLineCount: row.requirement_line_count,
          coveragePercent: row.coverage_percent,
          comparableTotal: row.comparable_total,
          currencyCode: row.currency_code,
        })),
      };
    });
  }
}
