import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { InternalHOperationsController } from './internal-h-operations.controller.js';
import { InternalHOperationsService } from './internal-h-operations.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, IdentityModule],
  controllers: [InternalHOperationsController],
  providers: [InternalHOperationsService],
  exports: [InternalHOperationsService],
})
export class HOperationsModule {}
