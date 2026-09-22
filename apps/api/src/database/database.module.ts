import { Module } from '@nestjs/common';
import { RuntimeDatabaseService } from './runtime-database.service.js';
import { TenantTransactionService } from './tenant-transaction.service.js';

@Module({
  providers: [RuntimeDatabaseService, TenantTransactionService],
  exports: [RuntimeDatabaseService, TenantTransactionService],
})
export class DatabaseModule {}
