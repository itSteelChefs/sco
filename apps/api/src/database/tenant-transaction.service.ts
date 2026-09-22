import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { RuntimeDatabaseService } from './runtime-database.service.js';

@Injectable()
export class TenantTransactionService {
  constructor(@Inject(RuntimeDatabaseService) private readonly database: RuntimeDatabaseService) {}

  async withTenant<T>(actorUserId: string, tenantId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.database.withActor(actorUserId, async (client) => {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return callback(client);
    });
  }
}
