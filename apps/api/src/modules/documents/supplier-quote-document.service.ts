import { Inject, Injectable } from '@nestjs/common';
import { forbidden } from '../../common/http/api-error.js';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { DevelopmentStorageProvider } from './development-storage.provider.js';

@Injectable()
export class SupplierQuoteDocumentService {
  constructor(
    @Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService,
    @Inject(DevelopmentStorageProvider) private readonly storage: DevelopmentStorageProvider,
  ) {}

  async metadata(actorId: string, documentId: string) {
    const document = await this.internal.supplierQuoteDocument(actorId, documentId);
    if (!document) throw forbidden();
    return { filename: document.filename, mimeType: document.detected_mime_type, byteSize: Number(document.byte_size) };
  }

  async content(actorId: string, documentId: string) {
    const document = await this.internal.supplierQuoteDocument(actorId, documentId);
    if (!document) throw forbidden();
    return { filename: document.filename, mimeType: document.detected_mime_type, byteSize: Number(document.byte_size), content: await this.storage.readPrivate(document.storage_key) };
  }
}
