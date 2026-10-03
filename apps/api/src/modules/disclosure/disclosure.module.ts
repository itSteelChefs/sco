import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { DisclosureAliasService } from './disclosure-alias.service.js';
import { DisclosureDatabaseService } from './disclosure-database.service.js';
import { DisclosurePolicyService } from './disclosure-policy.service.js';
import { DisclosureProjectionService } from './disclosure-projection.service.js';

@Module({
  imports: [DatabaseModule, AuditModule, RbacModule],
  providers: [DisclosureAliasService, DisclosureDatabaseService, DisclosurePolicyService, DisclosureProjectionService],
  exports: [DisclosureAliasService, DisclosurePolicyService, DisclosureProjectionService],
})
export class DisclosureModule {}
