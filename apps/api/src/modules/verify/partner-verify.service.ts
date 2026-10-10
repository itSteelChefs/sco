import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError, notFound } from '../../common/http/api-error.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PurposeDecisionAuthorityService } from '../rbac/purpose-decision-authority.service.js';
import { withPartnerVerifyErrors } from './partner-verify-errors.js';
import type { PartnerVerifyAttachQuoteDto, PartnerVerifyCreateDto, PartnerVerifySubmitDto } from './partner-verify-write.dto.js';

type PartnerVerifyCoverageEntry = {
  currency: string;
  totalLineCount: number;
  verifiedLineCount: number;
  excludedLineCount: number;
  insufficientLineCount: number;
  lineCoveragePercent: number;
  valueCoveragePercent: number;
};

type PartnerVerifyResultDto = {
  requestId: string;
  revisionId: string;
  runId: string;
  resultId: string;
  status: string;
  classification: string;
  finalizedAt: string;
  coverage: PartnerVerifyCoverageEntry[];
};

type PartnerVerifyResultRow = {
  request_id: string;
  revision_id: string;
  run_id: string;
  result_id: string;
  status: string;
  classification: string;
  finalized_at: string;
  coverage: Array<Record<string, unknown>> | null;
};

@Injectable()
export class PartnerVerifyService {
  constructor(
    @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService,
    @Inject(PurposeDecisionAuthorityService) private readonly purposeDecisions: PurposeDecisionAuthorityService,
  ) {}

  async getResult(tenant: TenantContext, requestId: string): Promise<PartnerVerifyResultDto> {
    const result = await this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
      const binding = (await client.query<{ backend_pid: number; transaction_id: string }>('SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id')).rows[0];
      const decisionId = await this.purposeDecisions.issuePartnerVerifyRead(tenant.userId, tenant.companyId);
      await this.purposeDecisions.consumePartnerVerifyRead(decisionId, tenant.userId, tenant.companyId, binding.backend_pid, binding.transaction_id);
      await client.query("SELECT set_config('app.purpose_decision', $1, true)", [decisionId]);
      return client.query<PartnerVerifyResultRow>('SELECT * FROM public.partner_verify_result_get($1,$2,$3)', [tenant.userId, tenant.companyId, requestId]);
    });
    const row = result.rows[0];
    if (!row) throw notFound();
    return this.toDto(row);
  }

  createDraft(tenant: TenantContext, body: PartnerVerifyCreateDto): Promise<{ requestId: string; status: 'DRAFT'; productMode: 'QUOTE_CHECK' }> {
    if (body.productMode !== 'QUOTE_CHECK') {
      throw new ApiError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST);
    }
    return withPartnerVerifyErrors(async () => {
      const requestId = await this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const result = await client.query<{ request_id: string }>(
          'SELECT public.partner_verify_request_create($1,$2,$3) AS request_id',
          [tenant.userId, tenant.companyId, randomUUID()],
        );
        return result.rows[0].request_id;
      });
      return { requestId, status: 'DRAFT' as const, productMode: 'QUOTE_CHECK' as const };
    });
  }

  attachQuote(tenant: TenantContext, requestId: string, body: PartnerVerifyAttachQuoteDto): Promise<{ requestId: string; revisionId: string; status: string }> {
    return withPartnerVerifyErrors(async () => {
      return this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const doc = await client.query<{ id: string }>(
          `SELECT d.id FROM documents d
           JOIN document_versions v ON v.document_id = d.id
          WHERE d.id=$1 AND v.id=$2 AND d.company_id=$3 AND d.status='AVAILABLE'`,
          [body.documentId, body.documentVersionId, tenant.companyId],
        );
        if (!doc.rows[0]) throw new Error('DOCUMENT_LINK_INVALID');

        const lines = body.lines.map((line) => ({
          lineNumber: line.lineNumber,
          lineReference: line.lineReference ?? null,
          itemDescription: line.itemDescription ?? null,
          productIdentityId: line.productIdentityId ?? null,
          unitId: line.unitId,
          quantity: line.quantity,
          currencyCode: line.currencyCode,
          unitPrice: line.unitPrice,
          isPriceBearing: line.isPriceBearing ?? true,
          isInformational: line.isInformational ?? false,
          isRealZeroValue: line.isRealZeroValue ?? (line.unitPrice === 0),
          suspectedDuplicate: false,
        }));
        const fingerprint = createHash('sha256')
          .update(JSON.stringify({ documentId: body.documentId, versionId: body.documentVersionId, currencies: body.currencies, lines }))
          .digest('hex');

        const revision = await client.query<{ revision_id: string }>(
          `SELECT public.partner_verify_revision_create(
             $1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12
           ) AS revision_id`,
          [
            tenant.userId,
            tenant.companyId,
            requestId,
            body.expectedPredecessorRevisionId ?? null,
            body.currencies,
            JSON.stringify({ productMode: 'QUOTE_CHECK' }),
            body.documentId,
            body.documentVersionId,
            fingerprint,
            JSON.stringify(lines),
            body.idempotencyKey,
            randomUUID(),
          ],
        );
        const revisionId = revision.rows[0].revision_id;
        await client.query('SELECT public.partner_verify_revision_mark_ready($1,$2,$3,$4::text)', [
          tenant.userId,
          tenant.companyId,
          revisionId,
          randomUUID(),
        ]);
        return { requestId, revisionId, status: 'DRAFT' };
      });
    });
  }

  submit(tenant: TenantContext, requestId: string, body: PartnerVerifySubmitDto): Promise<{ requestId: string; revisionId: string; status: 'SUBMITTED' }> {
    return withPartnerVerifyErrors(async () => {
      return this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const result = await client.query<{ request_id: string; revision_id: string; status: string }>(
          'SELECT * FROM public.partner_verify_request_submit_checked($1,$2,$3,$4,$5)',
          [tenant.userId, tenant.companyId, requestId, body.revisionId, randomUUID()],
        );
        const row = result.rows[0];
        return { requestId: row.request_id, revisionId: row.revision_id, status: 'SUBMITTED' as const };
      });
    });
  }

  private toDto(row: PartnerVerifyResultRow): PartnerVerifyResultDto {
    return {
      requestId: row.request_id,
      revisionId: row.revision_id,
      runId: row.run_id,
      resultId: row.result_id,
      status: row.status,
      classification: row.classification,
      finalizedAt: row.finalized_at,
      coverage: (row.coverage ?? []).map((entry) => ({
        currency: String(entry.currency),
        totalLineCount: Number(entry.totalLineCount),
        verifiedLineCount: Number(entry.verifiedLineCount),
        excludedLineCount: Number(entry.excludedLineCount),
        insufficientLineCount: Number(entry.insufficientLineCount),
        lineCoveragePercent: Number(entry.lineCoveragePercent),
        valueCoveragePercent: Number(entry.valueCoveragePercent),
      })),
    };
  }
}
