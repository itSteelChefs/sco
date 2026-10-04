import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { ServiceAccessService } from './service-access.service.js';

@Module({
  imports: [DatabaseModule, RbacModule],
  providers: [ServiceAccessService],
  exports: [ServiceAccessService],
})
export class ServiceAccessModule {}
