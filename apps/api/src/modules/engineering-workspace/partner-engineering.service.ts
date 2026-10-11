import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { withEngineeringErrors } from './engineering.errors.js';
import type { PartnerEngineeringDocumentLinkDto, PartnerEngineeringRequestDraftDto } from './partner-engineering.dto.js';

@Injectable()
export class PartnerEngineeringService {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService) {}

  create(tenant: TenantContext, body: PartnerEngineeringRequestDraftDto) {
    return withEngineeringErrors(async () => {
      const id = await this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.partner_engineering_request_create($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id`,
          [
            tenant.userId,
            tenant.companyId,
            body.title,
            body.sector,
            body.description ?? null,
            body.requestType ?? 'BOQ_PREPARATION',
            body.projectReference ?? null,
            body.idempotencyKey ?? null,
            randomUUID(),
          ],
        );
        return result.rows[0].id;
      });
      return this.get(tenant, id);
    });
  }

  updateDraft(tenant: TenantContext, id: string, body: PartnerEngineeringRequestDraftDto) {
    return withEngineeringErrors(async () => {
      await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) =>
        client.query(`SELECT public.partner_engineering_request_update_draft($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
          tenant.userId,
          tenant.companyId,
          id,
          body.title,
          body.sector,
          body.description ?? null,
          body.requestType ?? null,
          body.projectReference ?? null,
          randomUUID(),
        ]),
      );
      return this.get(tenant, id);
    });
  }

  submit(tenant: TenantContext, id: string) {
    return withEngineeringErrors(async () => {
      await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) =>
        client.query(`SELECT public.partner_engineering_request_submit($1,$2,$3,$4)`, [
          tenant.userId,
          tenant.companyId,
          id,
          randomUUID(),
        ]),
      );
      return this.get(tenant, id);
    });
  }

  linkDocument(tenant: TenantContext, requestId: string, body: PartnerEngineeringDocumentLinkDto) {
    return withEngineeringErrors(async () => {
      const linkId = await this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.partner_engineering_document_link($1,$2,$3,$4,$5,$6) AS id`,
          [tenant.userId, tenant.companyId, requestId, body.documentId, body.classification, randomUUID()],
        );
        return result.rows[0].id;
      });
      return { linkId, requestId, documentId: body.documentId, classification: body.classification };
    });
  }

  list(tenant: TenantContext) {
    return withEngineeringErrors(async () => {
      return this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const rows = await client.query(
          `SELECT id, title, sector, status, project_reference, submitted_at, updated_at
             FROM public.engineering_requests WHERE company_id=$1
            ORDER BY updated_at DESC LIMIT 200`,
          [tenant.companyId],
        );
        return rows.rows.map((row) => ({
          id: row.id,
          title: row.title,
          sector: row.sector,
          status: row.status,
          projectReference: row.project_reference,
          submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
          updatedAt: new Date(row.updated_at).toISOString(),
        }));
      });
    });
  }

  get(tenant: TenantContext, id: string) {
    return withEngineeringErrors(async () => {
      return this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const result = await client.query(`SELECT * FROM public.engineering_requests WHERE id=$1 AND company_id=$2`, [
          id,
          tenant.companyId,
        ]);
        const row = result.rows[0];
        if (!row) throw new Error('ENGINEERING_REQUEST_NOT_FOUND');
        const docs = await client.query(
          `SELECT id, document_id, classification, created_at FROM public.engineering_request_documents WHERE request_id=$1`,
          [id],
        );
        return {
          id: row.id,
          title: row.title,
          sector: row.sector,
          description: row.description,
          requestType: row.request_type,
          projectReference: row.project_reference,
          status: row.status,
          actionRequiredMessage: row.action_required_message,
          partnerVisibleNotes: row.partner_visible_notes,
          submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
          currentApprovedBoqVersionId: row.current_approved_boq_version_id,
          documents: docs.rows.map((d) => ({
            id: d.id,
            documentId: d.document_id,
            classification: d.classification,
            createdAt: new Date(d.created_at).toISOString(),
          })),
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        };
      });
    });
  }

  result(tenant: TenantContext, id: string) {
    return withEngineeringErrors(async () => {
      return this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        const result = await client.query<{ partner_engineering_result_get: Record<string, unknown> }>(
          `SELECT public.partner_engineering_result_get($1,$2,$3) AS partner_engineering_result_get`,
          [tenant.userId, tenant.companyId, id],
        );
        return result.rows[0].partner_engineering_result_get;
      });
    });
  }

  /** Safe CSV export of approved Partner-visible BOQ lines (no OSS). */
  resultCsv(tenant: TenantContext, id: string) {
    return withEngineeringErrors(async () => {
      const result = (await this.result(tenant, id)) as {
        approvedResult?: { lines?: Array<Record<string, unknown>>; versionNumber?: number } | null;
        title?: string;
      };
      if (!result.approvedResult?.lines) throw new Error('ENGINEERING_REQUEST_NOT_FOUND');
      const header = [
        'lineKey',
        'description',
        'specification',
        'discipline',
        'quantity',
        'unitId',
        'brandPreference',
        'modelPreference',
        'sourceReference',
      ];
      const escape = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = result.approvedResult.lines.map((line) =>
        header.map((h) => escape(line[h])).join(','),
      );
      return {
        filename: `engineering-boq-v${result.approvedResult.versionNumber ?? 'x'}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: [header.join(','), ...rows].join('\n'),
      };
    });
  }
}
