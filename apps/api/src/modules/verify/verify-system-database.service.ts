import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { MetricsService } from '../../observability/metrics.service.js';
import { createObservedPool } from '../../database/observed-pool.js';

@Injectable()
export class VerifySystemDatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Optional() @Inject(MetricsService) metrics?: MetricsService) {
    this.pool = createObservedPool(process.env.VERIFY_SYSTEM_DATABASE_URL, 'internal', metrics);
  }

  async onModuleDestroy() { await this.pool.end(); }

  async createRun(revisionId: string, methodologyVersion: string, evidenceFingerprint: string, retryOfRunId?: string, correlationId?: string) {
    const result = await this.pool.query<{ id: string }>(
      'SELECT public.internal_verify_system_run_create($1,$2,$3,$4,$5) AS id',
      [revisionId, methodologyVersion, evidenceFingerprint, retryOfRunId ?? null, correlationId ?? null],
    );
    return result.rows[0].id;
  }

  async startRun(runId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_verify_system_run_start($1,$2)', [runId, correlationId ?? null]);
  }

  async completeRun(runId: string, correlationId?: string) {
    await this.pool.query('SELECT public.internal_verify_system_run_complete($1,$2)', [runId, correlationId ?? null]);
  }

  async recordLineResult(runId: string, lineId: string, outcome: string, reason?: string, correlationId?: string) {
    const result = await this.pool.query<{ id: string }>(
      'SELECT public.internal_verify_system_line_result_record($1,$2,$3,$4,$5::uuid[],$6) AS id',
      [runId, lineId, outcome, reason ?? null, [], correlationId ?? null],
    );
    return result.rows[0].id;
  }
}
