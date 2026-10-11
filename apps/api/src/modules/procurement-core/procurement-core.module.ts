import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { PartnerProcurementController } from './partner-procurement.controller.js';
import { PartnerProcurementService } from './partner-procurement.service.js';
import { PartnerProcurementEligibilityService } from './partner-procurement-eligibility.js';
import { InternalProcurementController } from './internal-procurement.controller.js';
import { InternalProcurementService } from './internal-procurement.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, IdentityModule, RbacModule],
  controllers: [PartnerProcurementController, InternalProcurementController],
  providers: [
    PartnerProcurementService,
    PartnerProcurementEligibilityService,
    InternalProcurementService,
  ],
  exports: [PartnerProcurementEligibilityService],
})
export class ProcurementCoreModule {}
