import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { ProcurementIntelligenceService } from './procurement-intelligence.service.js';

@Module({
  imports: [DatabaseModule, RbacModule],
  providers: [ProcurementIntelligenceService],
  exports: [ProcurementIntelligenceService],
})
export class ProcurementIntelligenceModule {}
