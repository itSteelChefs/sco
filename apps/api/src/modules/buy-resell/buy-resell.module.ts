import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { InternalBuyResellController } from './internal-buy-resell.controller.js';
import { InternalBuyResellService } from './internal-buy-resell.service.js';
import { PartnerBuyResellController } from './partner-buy-resell.controller.js';
import { PartnerBuyResellService } from './partner-buy-resell.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, IdentityModule, RbacModule],
  controllers: [InternalBuyResellController, PartnerBuyResellController],
  providers: [InternalBuyResellService, PartnerBuyResellService],
})
export class BuyResellModule {}
