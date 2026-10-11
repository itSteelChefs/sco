import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { InternalGIntelligenceController } from './internal-g-intelligence.controller.js';
import { InternalGIntelligenceService } from './internal-g-intelligence.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, IdentityModule],
  controllers: [InternalGIntelligenceController],
  providers: [InternalGIntelligenceService],
  exports: [InternalGIntelligenceService],
})
export class GIntelligenceModule {}
