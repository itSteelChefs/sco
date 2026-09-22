import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

@Injectable()
export class CompaniesService {
  async findProjection(client: PoolClient, companyId: string) {
    const result = await client.query<{ id: string; name: string; tenantId: string }>(
      `SELECT id, name, current_setting('app.tenant_id', true) AS "tenantId"
       FROM "Company" WHERE id = $1`,
      [companyId],
    );
    return result.rows[0] ?? null;
  }
}
