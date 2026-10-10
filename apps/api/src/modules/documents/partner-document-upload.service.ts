import { randomUUID } from 'node:crypto';
import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ApiError } from '../../common/http/api-error.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PURPOSE } from '../rbac/purpose-registry.js';
import { DOCUMENT_STORAGE, type StorageProvider } from './storage-provider.js';
import type { PartnerDocumentUploadDto } from './partner-document-upload.dto.js';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'application/json']);

export type PartnerDocumentUploadResult = {
  documentId: string;
  versionId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  category: string;
  retentionClass: string;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  createdAt: string;
};

@Injectable()
export class PartnerDocumentUploadService {
  constructor(
    @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: StorageProvider,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async upload(tenant: TenantContext, body: PartnerDocumentUploadDto): Promise<PartnerDocumentUploadResult> {
    const allowedCategories = new Set(['QUALIFICATION_SUPPORT', 'AGREEMENT_ARTIFACT', 'VERIFY_QUOTE', 'GENERAL']);
    if (!allowedCategories.has(body.category)) {
      throw new ApiError('DOCUMENT_TYPE_NOT_ALLOWED', HttpStatus.BAD_REQUEST);
    }
    if (body.filename.includes('..') || body.filename.includes('/') || body.filename.includes('\\')) {
      throw new ApiError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST);
    }
    const filename = this.normalizeFilename(body.filename);
    const contentType = body.contentType.trim().toLowerCase();
    if (!ALLOWED_MIME.has(contentType)) {
      throw new ApiError('DOCUMENT_TYPE_NOT_ALLOWED', HttpStatus.BAD_REQUEST);
    }
    let content: Buffer;
    try {
      content = Buffer.from(body.contentBase64, 'base64');
    } catch {
      throw new ApiError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST);
    }
    if (!content.length) throw new ApiError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST);
    if (content.byteLength > MAX_BYTES) throw new ApiError('DOCUMENT_TOO_LARGE', HttpStatus.BAD_REQUEST);

    if ((body.linkedEntityType == null) !== (body.linkedEntityId == null)) {
      throw new ApiError('DOCUMENT_LINK_INVALID', HttpStatus.BAD_REQUEST);
    }

    const retentionClass = body.category === 'VERIFY_QUOTE' ? 'PARTNER_ORIGINAL' : 'PARTNER_ORIGINAL';
    const documentId = randomUUID();
    const versionId = randomUUID();
    const storageKey = `${tenant.companyId}/${documentId}/${versionId}`;

    let staged: { storageKey: string; byteSize: number; sha256: string };
    try {
      staged = await this.storage.stage({ storageKey, content });
    } catch {
      throw new ApiError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
        if (body.linkedEntityType && body.linkedEntityId) {
          await this.assertLink(client, tenant.companyId, body.linkedEntityType, body.linkedEntityId);
        }
        await client.query(
          `INSERT INTO documents (
             id, company_id, uploader_user_id, filename, detected_mime_type, byte_size, storage_key, sha256, status, access_scope,
             document_category, retention_class, linked_entity_type, linked_entity_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'AVAILABLE','TENANT',$9,$10,$11,$12)`,
          [
            documentId,
            tenant.companyId,
            tenant.userId,
            filename,
            contentType,
            staged.byteSize,
            staged.storageKey,
            staged.sha256,
            body.category,
            retentionClass,
            body.linkedEntityType ?? null,
            body.linkedEntityId ?? null,
          ],
        );
        await client.query(
          `INSERT INTO document_versions (id, company_id, document_id, version, storage_key, sha256)
           VALUES ($1,$2,$3,1,$4,$5)`,
          [versionId, tenant.companyId, documentId, `${staged.storageKey}/v1`, staged.sha256],
        );
        await this.audit.recordInTenantTransaction(client, {
          scope: 'TENANT',
          companyId: tenant.companyId,
          actorUserId: tenant.userId,
          action: 'document.uploaded',
          entityType: 'Document',
          entityId: documentId,
          purposeCode: PURPOSE.DOCUMENT_CUSTODY,
          metadata: {
            category: body.category,
            retentionClass,
            byteSize: staged.byteSize,
            contentType,
            linkedEntityType: body.linkedEntityType ?? null,
            versionId,
          },
        });
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw error;
    }

    return {
      documentId,
      versionId,
      filename,
      contentType,
      byteSize: staged.byteSize,
      category: body.category,
      retentionClass,
      linkedEntityType: body.linkedEntityType ?? null,
      linkedEntityId: body.linkedEntityId ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  private normalizeFilename(raw: string): string {
    const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
    const cleaned = base.replace(/[^\w.\- ()[\]]+/g, '_').trim();
    if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned.includes('..')) {
      throw new ApiError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST);
    }
    return cleaned.slice(0, 240);
  }

  private async assertLink(client: PoolClient, companyId: string, type: string, entityId: string) {
    if (type === 'QUALIFICATION_APPLICATION') {
      const row = await client.query('SELECT id FROM qualification_applications WHERE id=$1 AND company_id=$2', [entityId, companyId]);
      if (!row.rows[0]) throw new ApiError('DOCUMENT_LINK_INVALID', HttpStatus.BAD_REQUEST);
      return;
    }
    if (type === 'VERIFY_REQUEST') {
      const row = await client.query('SELECT id FROM verify_requests WHERE id=$1 AND company_id=$2', [entityId, companyId]);
      if (!row.rows[0]) throw new ApiError('DOCUMENT_LINK_INVALID', HttpStatus.BAD_REQUEST);
      return;
    }
    if (type === 'AGREEMENT_POLICY_VERSION') {
      // Policies are platform-scoped; link is reference-only (no company column). Reject arbitrary table names already by DTO.
      const row = await client.query('SELECT id FROM partner_agreement_policy_versions WHERE id=$1', [entityId]);
      if (!row.rows[0]) throw new ApiError('DOCUMENT_LINK_INVALID', HttpStatus.BAD_REQUEST);
      return;
    }
    throw new ApiError('DOCUMENT_LINK_INVALID', HttpStatus.BAD_REQUEST);
  }
}
