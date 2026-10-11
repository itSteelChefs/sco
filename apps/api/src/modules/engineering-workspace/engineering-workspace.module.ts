import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { InternalEngineeringController } from './internal-engineering.controller.js';
import { InternalEngineeringService } from './internal-engineering.service.js';
import { PartnerEngineeringController } from './partner-engineering.controller.js';
import { PartnerEngineeringService } from './partner-engineering.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, IdentityModule, RbacModule],
  controllers: [PartnerEngineeringController, InternalEngineeringController],
  providers: [PartnerEngineeringService, InternalEngineeringService],
})
export class EngineeringWorkspaceModule {}
