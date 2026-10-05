import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { PartnerJourneyController } from './partner-journey.controller.js';
import { PartnerJourneyService } from './partner-journey.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, IdentityModule, RbacModule],
  controllers: [PartnerJourneyController],
  providers: [PartnerJourneyService],
})
export class PartnerJourneyModule {}
