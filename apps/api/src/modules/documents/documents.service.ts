import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { forbidden, notFound } from '../../common/http/api-error.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { DevelopmentStorageProvider } from './development-storage.provider.js';

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService,
    @Inject(DevelopmentStorageProvider) private readonly storage: DevelopmentStorageProvider,
  ) {}
  async authorizeDownload(documentId: string, context: TenantContext) {
    const row = await this.tenants.withTenant(context.userId, context.companyId, (client) => client.query<{ storageKey: string }>('SELECT storage_key AS "storageKey" FROM documents WHERE id = $1', [documentId]));
    if (!row.rows[0]) throw forbidden();
    return this.storage.authorizeDownload(row.rows[0].storageKey);
  }
  async stage(context: TenantContext, input: { filename: string; mimeType: string; content: Uint8Array }) {
    const key = `${context.companyId}/${randomUUID()}`;
    const staged = await this.storage.stage({ storageKey: key, content: input.content });
    return this.tenants.withTenant(context.userId, context.companyId, async (client) => {
      const result = await client.query('INSERT INTO documents (company_id, uploader_user_id, filename, detected_mime_type, byte_size, storage_key, sha256, status) VALUES ($1,$2,$3,$4,$5,$6,$7,\'AVAILABLE\') RETURNING id', [context.companyId, context.userId, input.filename, input.mimeType, staged.byteSize, staged.storageKey, staged.sha256]);
      return result.rows[0];
    });
  }
}
