import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { ServiceAccessModule } from '../service-access/service-access.module.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, IdentityModule, RbacModule, ServiceAccessModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
