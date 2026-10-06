import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { withAdmissionErrors } from './partner-admission.errors.js';
import { isAgreementAcceptanceLifecycleEligible } from '../partner-journey/agreement-actionability.js';
import { PermissionsService } from '../rbac/permissions.service.js';

interface AdmissionStatusRow extends QueryResultRow {
  partnership_type: string | null;
  partnership_status: string | null;
  qualification_status: string | null;
  agreement_ready: boolean;
}

interface AgreementRow extends QueryResultRow {
  agreement_type: string;
  version_code: string;
  content_text: string;
  effective_at: Date;
  required: boolean;
  acceptance_status: string;
  accepted_version_code: string | null;
}

@Injectable()
export class PartnerAdmissionService {
  constructor(
    @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  status(context: TenantContext) {
    return withAdmissionErrors(() => this.tenants.withTenant(context.userId, context.companyId, async (client) => {
      const result = await client.query<AdmissionStatusRow>('SELECT * FROM public.partner_admission_status()');
      const row = result.rows[0];
      return {
        partnershipType: row?.partnership_type ?? null,
        partnershipStatus: row?.partnership_status ?? null,
        qualificationStatus: row?.qualification_status ?? null,
        agreementReady: row?.agreement_ready ?? false,
      };
    }));
  }

  agreements(context: TenantContext) {
    return withAdmissionErrors(async () => {
      const canAcceptAgreements = await this.permissions.has(context, 'partner.agreement.accept');
      return this.tenants.withTenant(context.userId, context.companyId, async (client) => {
      const [result, statusResult] = await Promise.all([
        client.query<AgreementRow>('SELECT * FROM public.partner_agreement_current()'),
        client.query<AdmissionStatusRow>('SELECT * FROM public.partner_admission_status()'),
      ]);
      const status = statusResult.rows[0];
      return result.rows.map((row) => ({
        agreementType: row.agreement_type,
        version: row.version_code,
        content: row.content_text,
        effectiveAt: row.effective_at,
        required: row.required,
        acceptanceStatus: row.acceptance_status,
        acceptedVersion: row.accepted_version_code,
        actionable: canAcceptAgreements
          && row.required
          && ['NOT_ACCEPTED', 'REACCEPTANCE_REQUIRED'].includes(row.acceptance_status)
          && isAgreementAcceptanceLifecycleEligible(status?.partnership_status ?? null, status?.qualification_status ?? null),
      }));
      });
    });
  }

  accept(context: TenantContext, input: { agreementType: string; versionCode: string; idempotencyKey: string }) {
    return withAdmissionErrors(() => this.tenants.withTenant(context.userId, context.companyId, async (client) => {
      const result = await client.query(
        'SELECT * FROM public.partner_agreement_accept($1,$2,$3,$4)',
        [input.agreementType, input.versionCode, input.idempotencyKey, randomUUID()],
      );
      const row = result.rows[0];
      return {
        agreementType: row.agreement_type,
        version: row.version_code,
        acceptedAt: row.accepted_at,
        status: row.acceptance_status,
      };
    }));
  }
}
