import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { InternalDatabaseService } from '../../database/internal-database.service.js';

@Injectable()
export class CommercialInternalTransactionService {
  constructor(@Inject(InternalDatabaseService) private readonly database: InternalDatabaseService) {}

  async withScope<T>(actorUserId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.actor_id', $1, true)", [actorUserId]);
      return callback(client);
    });
  }
}
