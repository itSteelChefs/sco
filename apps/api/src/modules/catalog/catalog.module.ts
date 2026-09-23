import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CandidateService } from './candidate.service.js';
import { CandidateController } from './candidate.controller.js';

@Module({ imports: [DatabaseModule, AuditModule, IdentityModule, AuthModule], controllers: [CatalogController, CandidateController], providers: [CatalogService, CandidateService], exports: [CatalogService, CandidateService] })
export class CatalogModule {}
