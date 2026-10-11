import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { withAdmissionErrors } from './partner-admission.errors.js';
import type { PartnerQualificationDraftDto } from './partner-qualification.dto.js';

type QualificationRow = {
  id: string;
  status: string;
  review_state: string;
  action_required: boolean;
  action_required_reason: string | null;
  legal_name: string;
  commercial_identifier: string | null;
  responsible_person: string | null;
  contact_email: string;
  city: string | null;
  sector: string | null;
  need_type: string | null;
  procurement_size: string | null;
  procurement_frequency: string | null;
  submitted_at: Date | string | null;
  updated_at: Date | string;
};

export type PartnerQualificationDto = {
  id: string;
  status: string;
  reviewState: string;
  actionRequired: boolean;
  actionRequiredReason: string | null;
  companyName: string;
  commercialIdentifier: string | null;
  responsiblePerson: string | null;
  contact: string;
  city: string | null;
  sector: string | null;
  needType: string | null;
  procurementSize: string | null;
  procurementFrequency: string | null;
  submittedAt: string | null;
  updatedAt: string;
};

@Injectable()
export class PartnerQualificationService {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService) {}

  getCurrent(tenant: TenantContext): Promise<PartnerQualificationDto | null> {
    return withAdmissionErrors(async () => {
      const result = await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) =>
        client.query<QualificationRow>('SELECT * FROM public.partner_qualification_current($1,$2)', [tenant.userId, tenant.companyId]),
      );
      const row = result.rows[0];
      return row ? this.toDto(row) : null;
    });
  }

  saveDraft(tenant: TenantContext, body: PartnerQualificationDraftDto): Promise<PartnerQualificationDto> {
    return withAdmissionErrors(async () => {
      const correlation = randomUUID();
      await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) =>
        client.query(
          `SELECT public.partner_qualification_draft_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS id`,
          [
            tenant.userId,
            tenant.companyId,
            body.companyName,
            body.commercialIdentifier ?? null,
            body.responsiblePerson,
            body.contact,
            body.city,
            body.sector,
            body.needType,
            body.procurementSize,
            body.procurementFrequency,
            correlation,
          ],
        ),
      );
      const current = await this.getCurrent(tenant);
      if (!current) throw new Error('QUALIFICATION_NOT_FOUND');
      return current;
    });
  }

  submit(tenant: TenantContext): Promise<PartnerQualificationDto> {
    return withAdmissionErrors(async () => {
      await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) =>
        client.query('SELECT public.partner_qualification_submit($1,$2,$3) AS id', [tenant.userId, tenant.companyId, randomUUID()]),
      );
      const current = await this.getCurrent(tenant);
      if (!current) throw new Error('QUALIFICATION_NOT_FOUND');
      return current;
    });
  }

  private toDto(row: QualificationRow): PartnerQualificationDto {
    return {
      id: row.id,
      status: row.status,
      reviewState: row.review_state,
      actionRequired: row.action_required,
      actionRequiredReason: row.action_required_reason,
      companyName: row.legal_name,
      commercialIdentifier: row.commercial_identifier,
      responsiblePerson: row.responsible_person,
      contact: row.contact_email,
      city: row.city,
      sector: row.sector,
      needType: row.need_type,
      procurementSize: row.procurement_size,
      procurementFrequency: row.procurement_frequency,
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
