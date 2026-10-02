import { Inject, Injectable } from '@nestjs/common';
import { notFound } from '../../common/http/api-error.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PurposeDecisionAuthorityService } from '../rbac/purpose-decision-authority.service.js';

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
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService, @Inject(PurposeDecisionAuthorityService) private readonly purposeDecisions: PurposeDecisionAuthorityService) {}

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

  // Explicit allowlisted projection: only these named fields ever leave this method, regardless of what the
  // gateway function returns. Nothing confidential (supplier/evidence/negotiation/internal JSONB) is ever selected
  // by the gateway in the first place, so there is nothing of that kind here to accidentally forward.
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
