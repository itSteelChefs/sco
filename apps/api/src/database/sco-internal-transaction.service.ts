import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { RuntimeDatabaseService } from './runtime-database.service.js';

@Injectable()
export class ScoInternalTransactionService {
  constructor(@Inject(RuntimeDatabaseService) private readonly database: RuntimeDatabaseService) {}

  async withScope<T>(actorUserId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.actor_id', $1, true), set_config('app.sco_internal', 'true', true)", [actorUserId]);
      return callback(client);
    });
  }
}
