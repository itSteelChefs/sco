import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ScoInternalTransactionService } from '../../database/sco-internal-transaction.service.js';
import { withEngineeringErrors } from './engineering.errors.js';
import type {
  InternalAssignDto,
  InternalBoqLineDto,
  InternalDHandoffDto,
  InternalTransitionDto,
} from './internal-engineering.dto.js';

@Injectable()
export class InternalEngineeringService {
  constructor(@Inject(ScoInternalTransactionService) private readonly internal: ScoInternalTransactionService) {}

  listSubmitted(actorUserId: string) {
    return withEngineeringErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        if (
          !(
            await client.query<{ ok: boolean }>(
              `SELECT public.engineering_internal_capability($1,'engineering.request.review') AS ok`,
              [actorUserId],
            )
          ).rows[0].ok
        ) {
          throw new Error('ENGINEERING_REVIEW_FORBIDDEN');
        }
        const rows = await client.query(
          `SELECT id, company_id, title, sector, status, assigned_engineer_id, submitted_at, updated_at
             FROM public.engineering_requests WHERE status <> 'DRAFT'
            ORDER BY updated_at DESC LIMIT 200`,
        );
        return rows.rows.map((row) => ({
          id: row.id,
          companyId: row.company_id,
          title: row.title,
          sector: row.sector,
          status: row.status,
          assignedEngineerId: row.assigned_engineer_id,
          submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
          updatedAt: new Date(row.updated_at).toISOString(),
        }));
      });
    });
  }

  get(actorUserId: string, id: string) {
    return withEngineeringErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        if (
          !(
            await client.query<{ ok: boolean }>(
              `SELECT public.engineering_internal_capability($1,'engineering.request.review') AS ok`,
              [actorUserId],
            )
          ).rows[0].ok
        ) {
          throw new Error('ENGINEERING_REVIEW_FORBIDDEN');
        }
        const result = await client.query(`SELECT * FROM public.engineering_requests WHERE id=$1`, [id]);
        const row = result.rows[0];
        if (!row) throw new Error('ENGINEERING_REQUEST_NOT_FOUND');
        const versions = await client.query(
          `SELECT id, version_number, status, approved_at, created_at FROM public.engineering_boq_versions
            WHERE request_id=$1 ORDER BY version_number`,
          [id],
        );
        return {
          id: row.id,
          companyId: row.company_id,
          title: row.title,
          sector: row.sector,
          description: row.description,
          status: row.status,
          assignedEngineerId: row.assigned_engineer_id,
          actionRequiredMessage: row.action_required_message,
          partnerVisibleNotes: row.partner_visible_notes,
          internalNotes: row.internal_notes,
          currentApprovedBoqVersionId: row.current_approved_boq_version_id,
          versions: versions.rows.map((v) => ({
            id: v.id,
            versionNumber: v.version_number,
            status: v.status,
            approvedAt: v.approved_at ? new Date(v.approved_at).toISOString() : null,
            createdAt: new Date(v.created_at).toISOString(),
          })),
        };
      });
    });
  }

  assign(actorUserId: string, requestId: string, body: InternalAssignDto) {
    return withEngineeringErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_engineering_assign($1,$2,$3,$4)`, [
          actorUserId,
          requestId,
          body.engineerUserId,
          randomUUID(),
        ]),
      );
      return this.get(actorUserId, requestId);
    });
  }

  transition(actorUserId: string, requestId: string, body: InternalTransitionDto) {
    return withEngineeringErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_engineering_transition($1,$2,$3,$4,$5)`, [
          actorUserId,
          requestId,
          body.nextStatus,
          body.reason ?? null,
          randomUUID(),
        ]),
      );
      return this.get(actorUserId, requestId);
    });
  }

  createBoqVersion(actorUserId: string, requestId: string) {
    return withEngineeringErrors(async () => {
      const versionId = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_engineering_boq_version_create($1,$2,$3) AS id`,
          [actorUserId, requestId, randomUUID()],
        );
        return result.rows[0].id;
      });
      return this.getBoq(actorUserId, versionId);
    });
  }

  upsertLine(actorUserId: string, versionId: string, body: InternalBoqLineDto) {
    return withEngineeringErrors(async () => {
      const lineId = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_engineering_boq_line_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS id`,
          [
            actorUserId,
            versionId,
            body.lineId ?? null,
            body.description,
            body.specification ?? null,
            body.discipline ?? null,
            body.quantity,
            body.unitId,
            body.brandPreference ?? null,
            body.modelPreference ?? null,
            body.engineeringNotes ?? null,
            body.partnerVisibleNotes ?? null,
            body.sourceDocumentId ?? null,
            body.sourceReference ?? null,
            body.sortOrder ?? 0,
            randomUUID(),
          ],
        );
        return result.rows[0].id;
      });
      const boq = await this.getBoq(actorUserId, versionId);
      return { ...boq, upsertedLineId: lineId };
    });
  }

  approveBoq(actorUserId: string, versionId: string) {
    return withEngineeringErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_engineering_boq_approve($1,$2,$3)`, [
          actorUserId,
          versionId,
          randomUUID(),
        ]),
      );
      return this.getBoq(actorUserId, versionId);
    });
  }

  getBoq(actorUserId: string, versionId: string) {
    return withEngineeringErrors(async () => {
      return this.internal.withScope(actorUserId, async (client) => {
        if (
          !(
            await client.query<{ ok: boolean }>(
              `SELECT public.engineering_internal_capability($1,'engineering.request.review') AS ok`,
              [actorUserId],
            )
          ).rows[0].ok
        ) {
          throw new Error('ENGINEERING_REVIEW_FORBIDDEN');
        }
        const version = await client.query(`SELECT * FROM public.engineering_boq_versions WHERE id=$1`, [versionId]);
        const row = version.rows[0];
        if (!row) throw new Error('ENGINEERING_BOQ_NOT_FOUND');
        const lines = await client.query(
          `SELECT * FROM public.engineering_boq_lines WHERE boq_version_id=$1 ORDER BY sort_order, description`,
          [versionId],
        );
        return {
          id: row.id,
          requestId: row.request_id,
          companyId: row.company_id,
          versionNumber: row.version_number,
          status: row.status,
          supersedesVersionId: row.supersedes_version_id,
          approvedBy: row.approved_by,
          approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
          partnerVisibleNotes: row.partner_visible_notes,
          internalNotes: row.internal_notes,
          lines: lines.rows.map((line) => ({
            id: line.id,
            lineKey: line.line_key,
            description: line.description,
            specification: line.specification,
            discipline: line.discipline,
            quantity: line.quantity,
            unitId: line.unit_id,
            brandPreference: line.brand_preference,
            modelPreference: line.model_preference,
            engineeringNotes: line.engineering_notes,
            partnerVisibleNotes: line.partner_visible_notes,
            sourceDocumentId: line.source_document_id,
            sourceReference: line.source_reference,
            sortOrder: line.sort_order,
          })),
        };
      });
    });
  }

  handoffToD(actorUserId: string, versionId: string, body: InternalDHandoffDto) {
    return withEngineeringErrors(async () => {
      const handoffId = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_engineering_d_handoff($1,$2,$3,$4,$5) AS id`,
          [actorUserId, versionId, body.deliveryLocation, body.idempotencyKey, randomUUID()],
        );
        return result.rows[0].id;
      });
      return this.internal.withScope(actorUserId, async (client) => {
        const row = (
          await client.query(`SELECT * FROM public.engineering_d_handoffs WHERE id=$1`, [handoffId])
        ).rows[0];
        return {
          handoffId: row.id,
          requestId: row.request_id,
          companyId: row.company_id,
          boqVersionId: row.boq_version_id,
          procurementRequirementId: row.procurement_requirement_id,
          handedOffAt: new Date(row.handed_off_at).toISOString(),
          status: row.status,
        };
      });
    });
  }
}
