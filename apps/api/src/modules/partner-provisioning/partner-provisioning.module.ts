import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { PartnerProvisioningController } from './partner-provisioning.controller.js';
import { PartnerProvisioningService } from './partner-provisioning.service.js';
@Module({ imports: [DatabaseModule, IdentityModule, AuthModule], controllers: [PartnerProvisioningController], providers: [PartnerProvisioningService] }) export class PartnerProvisioningModule {}
