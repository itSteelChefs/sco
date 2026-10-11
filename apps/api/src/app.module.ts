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
import { HealthController } from './common/http/health.controller.js';
import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { correlationIdMiddleware } from './common/http/correlation-id.middleware.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { VerifyModule } from './modules/verify/verify.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { MetricsController } from './observability/metrics.controller.js';
import { DisclosureModule } from './modules/disclosure/disclosure.module.js';
import { ProcurementIntelligenceModule } from './modules/procurement-intelligence/procurement-intelligence.module.js';
import { ServiceAccessModule } from './modules/service-access/service-access.module.js';
import { WorkspaceModule } from './modules/workspaces/workspace.module.js';
import { PartnerJourneyModule } from './modules/partner-journey/partner-journey.module.js';
import { PartnerProvisioningModule } from './modules/partner-provisioning/partner-provisioning.module.js';
import { ProcurementCoreModule } from './modules/procurement-core/procurement-core.module.js';
import { BuyResellModule } from './modules/buy-resell/buy-resell.module.js';
import { EngineeringWorkspaceModule } from './modules/engineering-workspace/engineering-workspace.module.js';
import { GIntelligenceModule } from './modules/g-intelligence/g-intelligence.module.js';
import { HOperationsModule } from './modules/h-operations/h-operations.module.js';

@Module({ imports: [ObservabilityModule, DatabaseModule, IdentityModule, AuthModule, RbacModule, AuditModule, DocumentsModule, CatalogModule, VerifyModule, DisclosureModule, ProcurementIntelligenceModule, ServiceAccessModule, WorkspaceModule, PartnerJourneyModule, PartnerProvisioningModule, ProcurementCoreModule, BuyResellModule, EngineeringWorkspaceModule, GIntelligenceModule, HOperationsModule], controllers: [OperationsController, PartnerController, ApiFoundationController, HealthController, MetricsController] })
export class AppModule implements NestModule { configure(consumer: MiddlewareConsumer) { consumer.apply(correlationIdMiddleware).forRoutes('*'); } }
