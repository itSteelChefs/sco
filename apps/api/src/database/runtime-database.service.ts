import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class RuntimeDatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });

  async onModuleDestroy() {
    await this.pool.end();
  }

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async withActor<T>(actorUserId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.actor_id', $1, true)", [actorUserId]);
      return callback(client);
    });
  }

  async currentRole(): Promise<string> {
    const result = await this.pool.query<{ current_user: string }>('SELECT current_user');
    return result.rows[0].current_user;
  }

  async query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
    return this.pool.query<T>(sql, values);
  }
}
