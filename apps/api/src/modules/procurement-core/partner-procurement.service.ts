import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { withProcurementErrors } from './procurement-core.errors.js';
import type { PartnerProcurementLineDto, PartnerProcurementRequirementDraftDto } from './partner-procurement.dto.js';

type RequirementRow = {
  id: string;
  company_id: string;
  title: string;
  reference_code: string | null;
  sector: string;
  project_reference: string | null;
  delivery_location: string;
  needed_by: string | null;
  notes: string | null;
  status: string;
  submitted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type LineRow = {
  id: string;
  line_key: string;
  description: string;
  specification: string | null;
  quantity: string;
  unit_id: string;
  brand_preference: string | null;
  model_preference: string | null;
  technical_notes: string | null;
  sort_order: number;
};

@Injectable()
export class PartnerProcurementService {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService) {}

  list(tenant: TenantContext): Promise<ReturnType<PartnerProcurementService['toRequirementDto']>[]> {
    return withProcurementErrors(async () => {
      const rows = await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) =>
        client.query<RequirementRow>(
          `SELECT * FROM public.procurement_requirements
            WHERE company_id=$1
            ORDER BY updated_at DESC
            LIMIT 100`,
          [tenant.companyId],
        ),
      );
      return rows.rows.map((row) => this.toRequirementDto(row));
    });
  }

  get(tenant: TenantContext, id: string) {
    return withProcurementErrors(async () => {
      return this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const req = await client.query<RequirementRow>(
          `SELECT * FROM public.procurement_requirements WHERE id=$1 AND company_id=$2`,
          [id, tenant.companyId],
        );
        const row = req.rows[0];
        if (!row) throw new Error('PROCUREMENT_REQUIREMENT_NOT_FOUND');
        const lines = await client.query<LineRow>(
          `SELECT * FROM public.procurement_requirement_lines WHERE requirement_id=$1 ORDER BY sort_order, created_at`,
          [id],
        );
        return { ...this.toRequirementDto(row), lines: lines.rows.map((line) => this.toLineDto(line)) };
      });
    });
  }

  create(tenant: TenantContext, body: PartnerProcurementRequirementDraftDto) {
    return withProcurementErrors(async () => {
      const id = await this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.partner_procurement_requirement_create($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10) AS id`,
          [
            tenant.userId,
            tenant.companyId,
            body.title,
            body.sector,
            body.deliveryLocation,
            body.referenceCode ?? null,
            body.projectReference ?? null,
            body.neededBy ?? null,
            body.notes ?? null,
            randomUUID(),
          ],
        );
        return result.rows[0].id;
      });
      return this.get(tenant, id);
    });
  }

  updateDraft(tenant: TenantContext, id: string, body: PartnerProcurementRequirementDraftDto) {
    return withProcurementErrors(async () => {
      await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) =>
        client.query(
          `SELECT public.partner_procurement_requirement_update_draft($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11)`,
          [
            tenant.userId,
            tenant.companyId,
            id,
            body.title,
            body.sector,
            body.deliveryLocation,
            body.referenceCode ?? null,
            body.projectReference ?? null,
            body.neededBy ?? null,
            body.notes ?? null,
            randomUUID(),
          ],
        ),
      );
      return this.get(tenant, id);
    });
  }

  submit(tenant: TenantContext, id: string) {
    return withProcurementErrors(async () => {
      await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) =>
        client.query(`SELECT public.partner_procurement_requirement_submit($1,$2,$3,$4)`, [
          tenant.userId,
          tenant.companyId,
          id,
          randomUUID(),
        ]),
      );
      return this.get(tenant, id);
    });
  }

  upsertLine(tenant: TenantContext, requirementId: string, body: PartnerProcurementLineDto) {
    return withProcurementErrors(async () => {
      const lineId = await this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.partner_procurement_line_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS id`,
          [
            tenant.userId,
            tenant.companyId,
            requirementId,
            body.lineId ?? null,
            body.description,
            body.specification ?? null,
            body.quantity,
            body.unitId,
            body.brandPreference ?? null,
            body.modelPreference ?? null,
            body.technicalNotes ?? null,
            body.sortOrder ?? 0,
            randomUUID(),
          ],
        );
        return result.rows[0].id;
      });
      const detail = await this.get(tenant, requirementId);
      return { ...detail, upsertedLineId: lineId };
    });
  }

  comparison(tenant: TenantContext, requirementId: string) {
    return withProcurementErrors(async () => {
      const result = await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) =>
        client.query(
          `SELECT * FROM public.partner_procurement_comparison_get($1,$2,$3)`,
          [tenant.userId, tenant.companyId, requirementId],
        ),
      );
      const row = result.rows[0];
      if (!row) throw new Error('PROCUREMENT_COMPARISON_NOT_FOUND');
      return {
        comparisonId: row.comparison_id,
        requirementId: row.requirement_id,
        status: row.status,
        entries: row.entries,
        lineAssessments: row.line_assessments,
        selection: row.selection,
      };
    });
  }

  private toRequirementDto(row: RequirementRow) {
    return {
      id: row.id,
      companyId: row.company_id,
      title: row.title,
      referenceCode: row.reference_code,
      sector: row.sector,
      projectReference: row.project_reference,
      deliveryLocation: row.delivery_location,
      neededBy: row.needed_by,
      notes: row.notes,
      status: row.status,
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private toLineDto(row: LineRow) {
    return {
      id: row.id,
      lineKey: row.line_key,
      description: row.description,
      specification: row.specification,
      quantity: row.quantity,
      unitId: row.unit_id,
      brandPreference: row.brand_preference,
      modelPreference: row.model_preference,
      technicalNotes: row.technical_notes,
      sortOrder: row.sort_order,
    };
  }
}
