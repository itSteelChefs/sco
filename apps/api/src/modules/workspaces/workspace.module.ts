import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { ServiceAccessModule } from '../service-access/service-access.module.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';
import { DEFAULT_WORKSPACE_CAPABILITIES, WORKSPACE_CAPABILITY_REGISTRY } from './workspace-capability-registry.js';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, AuthorizationModule, IdentityModule, RbacModule, ServiceAccessModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, { provide: WORKSPACE_CAPABILITY_REGISTRY, useValue: DEFAULT_WORKSPACE_CAPABILITIES }],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
