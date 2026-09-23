import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DevelopmentStorageProvider } from './development-storage.provider.js';
import { DocumentsService } from './documents.service.js';
@Module({ imports: [DatabaseModule], providers: [DevelopmentStorageProvider, DocumentsService], exports: [DocumentsService] })
export class DocumentsModule {}
