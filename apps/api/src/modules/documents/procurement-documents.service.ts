import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PURPOSE } from '../rbac/purpose-registry.js';
import { DeterministicExtractionProvider } from './deterministic-extraction.provider.js';
import type { DocumentExtractionLine } from './extraction.contract.js';

@Injectable()
export class ProcurementDocumentsService {
  constructor(@Inject(TenantTransactionService) private readonly tenants: TenantTransactionService, @Inject(DeterministicExtractionProvider) private readonly extraction: DeterministicExtractionProvider, @Inject(AuditService) private readonly audit: AuditService) {}

  async register(context: TenantContext, input: { documentId: string; filename: string; documentType: string; sourceMetadata?: unknown }) {
    return this.tenants.withTenant(context.userId, context.companyId, async (client) => {
      const result = await client.query(`INSERT INTO procurement_documents (company_id,uploader_user_id,document_id,filename,document_type,source_metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id,company_id AS "companyId",uploader_user_id AS "uploaderUserId",filename,document_type AS "documentType",processing_status AS "processingStatus",extraction_status AS "extractionStatus"`, [context.companyId, context.userId, input.documentId, input.filename, input.documentType, JSON.stringify(input.sourceMetadata ?? null)]);
        await this.audit.recordInTenantTransaction(client, { actorUserId: context.userId, companyId: context.companyId, scope: 'TENANT', action: 'procurement_document.uploaded', entityType: 'ProcurementDocument', entityId: result.rows[0].id, purposeCode: PURPOSE.DOCUMENT_CUSTODY });
      return result.rows[0];
    });
  }

  async extract(context: TenantContext, id: string, lines: DocumentExtractionLine[]) {
    return this.tenants.withTenant(context.userId, context.companyId, async (client) => {
      const doc = await client.query(`SELECT id,filename,document_type AS "documentType" FROM procurement_documents WHERE id=$1 FOR UPDATE`, [id]);
      if (!doc.rowCount) throw new NotFoundException();
      await client.query(`UPDATE procurement_documents SET processing_status='PROCESSING',extraction_status='PROCESSING',updated_at=now() WHERE id=$1`, [id]);
      try {
        const result = await this.extraction.extract({ filename: doc.rows[0].filename, documentType: doc.rows[0].documentType, structuredLines: lines });
        for (const line of result.lines) await client.query(`INSERT INTO procurement_document_lines (company_id,document_id,line_number,page_reference,sheet_reference,raw_value,description,quantity,unit,brand,manufacturer,model_reference,technical_specification,extraction_metadata,normalized_value) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb)`, [context.companyId, id, line.lineNumber ?? null, line.pageReference ?? null, line.sheetReference ?? null, JSON.stringify(line.rawValue), line.description ?? null, line.quantity ?? null, line.unit ?? null, line.brand ?? null, line.manufacturer ?? null, line.modelReference ?? null, JSON.stringify(line.technicalSpecification ?? null), JSON.stringify({ provider: result.provider, model: result.model }), JSON.stringify(line)]);
        await client.query(`UPDATE procurement_documents SET processing_status='EXTRACTED',extraction_status='READY_FOR_REVIEW',updated_at=now() WHERE id=$1`, [id]);
          await this.audit.recordInTenantTransaction(client, { actorUserId: context.userId, companyId: context.companyId, scope: 'TENANT', action: 'procurement_document.extraction_completed', entityType: 'ProcurementDocument', entityId: id, metadata: { lineCount: result.lines.length, provider: result.provider }, purposeCode: PURPOSE.DOCUMENT_CUSTODY });
        return { id, lineCount: result.lines.length, status: 'READY_FOR_REVIEW' };
      } catch (error) {
        await client.query(`UPDATE procurement_documents SET processing_status='FAILED',extraction_status='FAILED',updated_at=now() WHERE id=$1`, [id]);
          await this.audit.recordInTenantTransaction(client, { actorUserId: context.userId, companyId: context.companyId, scope: 'TENANT', action: 'procurement_document.extraction_failed', entityType: 'ProcurementDocument', entityId: id, purposeCode: PURPOSE.DOCUMENT_CUSTODY });
        throw error;
      }
    });
  }
}
