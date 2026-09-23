import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { RbacModule } from './modules/rbac/rbac.module.js';
import { OperationsController } from './modules/operations/operations.controller.js';
import { PartnerController } from './modules/partner/partner.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { ApiFoundationController } from './common/http/api-foundation.controller.js';
import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { correlationIdMiddleware } from './common/http/correlation-id.middleware.js';

@Module({ imports: [DatabaseModule, IdentityModule, AuthModule, RbacModule, AuditModule, DocumentsModule], controllers: [OperationsController, PartnerController, ApiFoundationController] })
export class AppModule implements NestModule { configure(consumer: MiddlewareConsumer) { consumer.apply(correlationIdMiddleware).forRoutes('*'); } }
