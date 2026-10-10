import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DocumentsService } from './documents.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { DeterministicExtractionProvider } from './deterministic-extraction.provider.js';
import { ProcurementDocumentsService } from './procurement-documents.service.js';
import { SupplierQuoteDocumentService } from './supplier-quote-document.service.js';
import { ProcurementDocumentsController } from './procurement-documents.controller.js';
import { PartnerDocumentUploadController } from './partner-document-upload.controller.js';
import { PartnerDocumentUploadService } from './partner-document-upload.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { createDocumentStorageProvider, DOCUMENT_STORAGE } from './storage-provider.js';
import { MetricsService } from '../../observability/metrics.service.js';
@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, IdentityModule, RbacModule, AuthorizationModule],
  controllers: [ProcurementDocumentsController, PartnerDocumentUploadController],
  providers: [
    { provide: DOCUMENT_STORAGE, inject: [MetricsService], useFactory: (metrics: MetricsService) => createDocumentStorageProvider(process.env, metrics) },
    DocumentsService,
    DeterministicExtractionProvider,
    ProcurementDocumentsService,
    SupplierQuoteDocumentService,
    PartnerDocumentUploadService,
  ],
  exports: [DocumentsService, ProcurementDocumentsService, SupplierQuoteDocumentService, PartnerDocumentUploadService],
})
export class DocumentsModule {}
