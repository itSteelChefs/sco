import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { DatabaseModule } from '../../database/database.module.js';
import { CompaniesService } from './companies.service.js';
import { CompanyAccessController } from './company-access.controller.js';
import { MembershipsService } from './memberships.service.js';
import { TenantProbesController } from './tenant-probes.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [DatabaseModule, forwardRef(() => AuthModule)],
  controllers: [CompanyAccessController, TenantProbesController],
  providers: [UsersService, CompaniesService, MembershipsService, TenantGuard],
  exports: [UsersService, CompaniesService, MembershipsService],
})
export class IdentityModule {}
