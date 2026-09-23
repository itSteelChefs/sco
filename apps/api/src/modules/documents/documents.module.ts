import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DevelopmentStorageProvider } from './development-storage.provider.js';
import { DocumentsService } from './documents.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { DeterministicExtractionProvider } from './deterministic-extraction.provider.js';
import { ProcurementDocumentsService } from './procurement-documents.service.js';
import { SupplierQuoteDocumentService } from './supplier-quote-document.service.js';
import { ProcurementDocumentsController } from './procurement-documents.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityModule } from '../identity/identity.module.js';
@Module({ imports: [DatabaseModule, AuditModule, AuthModule, IdentityModule], controllers: [ProcurementDocumentsController], providers: [DevelopmentStorageProvider, DocumentsService, DeterministicExtractionProvider, ProcurementDocumentsService, SupplierQuoteDocumentService], exports: [DocumentsService, ProcurementDocumentsService, SupplierQuoteDocumentService] })
export class DocumentsModule {}
