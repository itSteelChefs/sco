import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { PartnerVerifyController } from './partner-verify.controller.js';
import { PartnerVerifyService } from './partner-verify.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, IdentityModule, RbacModule],
  controllers: [PartnerVerifyController],
  providers: [PartnerVerifyService],
})
export class VerifyModule {}
