import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { ResourceAuthorizationGuard } from './resource-authorization.guard.js';
import { ResourceAuthorizationService } from './resource-authorization.service.js';

@Module({
  imports: [DatabaseModule, AuditModule, IdentityModule, RbacModule],
  providers: [ResourceAuthorizationService, ResourceAuthorizationGuard],
  exports: [ResourceAuthorizationService, ResourceAuthorizationGuard],
})
export class AuthorizationModule {}
