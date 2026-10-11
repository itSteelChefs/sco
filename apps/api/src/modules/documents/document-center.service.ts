import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PURPOSE } from '../rbac/purpose-registry.js';
import { DOCUMENT_STORAGE, type StorageProvider } from './storage-provider.js';

type PartnerDocumentRow = {
  id: string;
  filename: string;
  detected_mime_type: string;
  byte_size: number;
  status: string;
  document_category: string | null;
  retention_class: string | null;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type DownloadRow = PartnerDocumentRow & { storage_key: string };

export type PartnerDocumentMetadata = {
  documentId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  status: string;
  category: string | null;
  retentionClass: string | null;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
};

function map(row: PartnerDocumentRow): PartnerDocumentMetadata {
  return {
    documentId: row.id,
    filename: row.filename,
    contentType: row.detected_mime_type,
    byteSize: Number(row.byte_size),
    status: row.status,
    category: row.document_category,
    retentionClass: row.retention_class,
    linkedEntityType: row.linked_entity_type,
    linkedEntityId: row.linked_entity_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

@Injectable()
export class DocumentCenterService {
  constructor(
    @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: StorageProvider,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async partnerList(tenant: TenantContext, page: number, pageSize: number): Promise<{ items: PartnerDocumentMetadata[]; page: number; pageSize: number }> {
    const result = await this.tenants.withTenant(tenant.userId, tenant.companyId, (client) => client.query<PartnerDocumentRow>(
      `SELECT id, filename, detected_mime_type, byte_size, status::text, document_category, retention_class,
              linked_entity_type, linked_entity_id, created_at, updated_at
         FROM documents WHERE company_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [tenant.companyId, pageSize, (page - 1) * pageSize],
    ));
    return { items: result.rows.map(map), page, pageSize };
  }

  async download(tenant: TenantContext, documentId: string, reply: FastifyReply): Promise<void> {
    const document = await this.tenants.withTenant(tenant.userId, tenant.companyId, async (client) => {
      const result = await client.query<DownloadRow>(
      `SELECT d.id, d.filename, d.detected_mime_type, d.byte_size, d.status::text, d.document_category,
                d.retention_class, d.linked_entity_type, d.linked_entity_id, d.created_at, d.updated_at,
                d.storage_key
           FROM documents d
          WHERE d.id=$1 AND d.company_id=$2 AND d.status='AVAILABLE'
          LIMIT 1`,
        [documentId, tenant.companyId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException();
      await this.audit.recordInTenantTransaction(client, {
        scope: 'TENANT', companyId: tenant.companyId, actorUserId: tenant.userId,
        action: 'document.accessed', entityType: 'Document', entityId: documentId,
        purposeCode: PURPOSE.DOCUMENT_CUSTODY,
      });
      return row;
    });
    const content = await this.storage.readPrivate(document.storage_key);
    reply.header('Content-Type', document.detected_mime_type);
    reply.header('Content-Length', String(content.byteLength));
    reply.header('Content-Disposition', `attachment; filename="${document.filename.replace(/[^\w. ()-]/g, '_')}"`);
    reply.header('Cache-Control', 'private, no-store');
    reply.send(Buffer.from(content));
  }
}
