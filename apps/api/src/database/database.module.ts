import { Module } from '@nestjs/common';
import { RuntimeDatabaseService } from './runtime-database.service.js';
import { TenantTransactionService } from './tenant-transaction.service.js';
import { ScoInternalTransactionService } from './sco-internal-transaction.service.js';

@Module({
  providers: [RuntimeDatabaseService, TenantTransactionService, ScoInternalTransactionService],
  exports: [RuntimeDatabaseService, TenantTransactionService, ScoInternalTransactionService],
})
export class DatabaseModule {}
