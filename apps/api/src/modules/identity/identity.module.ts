import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { DatabaseModule } from '../../database/database.module.js';
import { CompaniesService } from './companies.service.js';
import { CompanyAccessController } from './company-access.controller.js';
import { MembershipsService } from './memberships.service.js';
import { TenantProbesController } from './tenant-probes.controller.js';
import { UsersService } from './users.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { QualificationService } from './qualification.service.js';
import { PartnershipsService } from './partnerships.service.js';
import { QualificationController } from './qualification.controller.js';
import { ScoInternalGuard } from './sco-internal.guard.js';
import { MembershipEligibilityService } from './membership-eligibility.service.js';
import { PlanningService } from './planning.service.js';
import { ExecutionService } from './execution.service.js';
import { SupplierNetworkService } from './supplier-network.service.js';
import { RfqService } from './rfq.service.js';
import { AlternativeProductService } from './alternative-product.service.js';

@Module({
  imports: [DatabaseModule, AuditModule, forwardRef(() => AuthModule)],
  controllers: [CompanyAccessController, TenantProbesController, QualificationController],
  providers: [UsersService, CompaniesService, MembershipsService, TenantGuard, QualificationService, PartnershipsService, ScoInternalGuard, MembershipEligibilityService, PlanningService, ExecutionService, SupplierNetworkService, RfqService, AlternativeProductService],
  exports: [UsersService, CompaniesService, MembershipsService, QualificationService, PartnershipsService, MembershipEligibilityService, ScoInternalGuard, PlanningService, ExecutionService, SupplierNetworkService, RfqService, AlternativeProductService],
})
export class IdentityModule {}
