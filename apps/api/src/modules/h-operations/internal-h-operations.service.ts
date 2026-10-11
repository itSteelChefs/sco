import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ScoInternalTransactionService } from '../../database/sco-internal-transaction.service.js';
import { withHOperationsErrors } from './h-operations.errors.js';
import type {
  HAssignDto,
  HConfigSetDto,
  HCycleCreateDto,
  HCycleOverrideDto,
  HExceptionUpsertDto,
  HJobEnqueueDto,
  HQueueQueryDto,
  HResolveDto,
  HTransitionDto,
  HWorkUpsertDto,
} from './h-operations.dto.js';

@Injectable()
export class InternalHOperationsService {
  constructor(@Inject(ScoInternalTransactionService) private readonly internal: ScoInternalTransactionService) {}

  private scopeJson<T>(actorUserId: string, sql: string, params: unknown[]) {
    return withHOperationsErrors(async () =>
      this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ payload: T }>(sql, params);
        return result.rows[0].payload;
      }),
    );
  }

  upsertWork(actorUserId: string, body: HWorkUpsertDto) {
    return withHOperationsErrors(async () => {
      const id = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_h_work_item_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS id`,
          [
            actorUserId, body.domain, body.sourceEntityType, body.sourceEntityId, body.workType,
            body.priority ?? 50, body.dueAt ?? null, body.actionRequired ?? false, body.nextAction ?? null,
            body.partnerCompanyId ?? null, randomUUID(),
          ],
        );
        return result.rows[0].id;
      });
      return { id };
    });
  }

  queue(actorUserId: string, query: HQueueQueryDto) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_work_queue($1,$2,$3,$4,$5) AS payload`, [
      actorUserId, query.view ?? 'all', query.domain ?? null, query.limit ?? 50, query.offset ?? 0,
    ]);
  }

  assign(actorUserId: string, workItemId: string, body: HAssignDto) {
    return withHOperationsErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_h_work_item_assign($1,$2,$3,$4)`, [
          actorUserId, workItemId, body.assigneeUserId, randomUUID(),
        ]),
      );
      return { id: workItemId, assignedUserId: body.assigneeUserId };
    });
  }

  transition(actorUserId: string, workItemId: string, body: HTransitionDto) {
    return withHOperationsErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_h_work_item_transition($1,$2,$3,$4,$5)`, [
          actorUserId, workItemId, body.status, body.blockedReason ?? null, randomUUID(),
        ]),
      );
      return { id: workItemId, status: body.status };
    });
  }

  upsertException(actorUserId: string, body: HExceptionUpsertDto) {
    return withHOperationsErrors(async () => {
      const id = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_h_exception_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id`,
          [
            actorUserId, body.domain, body.sourceEntityType, body.sourceEntityId, body.exceptionType,
            body.retryable ?? false, body.safeErrorCode, body.safeErrorMessage, body.workItemId ?? null, randomUUID(),
          ],
        );
        return result.rows[0].id;
      });
      return this.getException(actorUserId, id);
    });
  }

  getException(actorUserId: string, id: string) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_exception_get($1,$2) AS payload`, [actorUserId, id]);
  }

  ackException(actorUserId: string, id: string) {
    return withHOperationsErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_h_exception_ack($1,$2,$3)`, [actorUserId, id, randomUUID()]),
      );
      return this.getException(actorUserId, id);
    });
  }

  retryException(actorUserId: string, id: string) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_exception_retry($1,$2,$3) AS payload`, [
      actorUserId, id, randomUUID(),
    ]);
  }

  resolveException(actorUserId: string, id: string, body: HResolveDto) {
    return withHOperationsErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_h_exception_resolve($1,$2,$3,$4)`, [
          actorUserId, id, body.note ?? null, randomUUID(),
        ]),
      );
      return this.getException(actorUserId, id);
    });
  }

  createCycle(actorUserId: string, body: HCycleCreateDto) {
    return withHOperationsErrors(async () => {
      const id = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_h_cycle_create($1,$2,$3,$4,$5) AS id`,
          [actorUserId, body.startsAt, body.cutoffAt, body.endsAt, randomUUID()],
        );
        return result.rows[0].id;
      });
      return this.getCycle(actorUserId, id);
    });
  }

  getCycle(actorUserId: string, id: string) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_cycle_get($1,$2) AS payload`, [actorUserId, id]);
  }

  lockCycle(actorUserId: string, id: string) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_cycle_lock($1,$2,$3) AS payload`, [
      actorUserId, id, randomUUID(),
    ]);
  }

  completeCycle(actorUserId: string, id: string) {
    return withHOperationsErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_h_cycle_complete($1,$2,$3)`, [actorUserId, id, randomUUID()]),
      );
      return this.getCycle(actorUserId, id);
    });
  }

  overrideCycle(actorUserId: string, id: string, body: HCycleOverrideDto) {
    return withHOperationsErrors(async () => {
      await this.internal.withScope(actorUserId, (client) =>
        client.query(`SELECT public.internal_h_cycle_override_include($1,$2,$3,$4,$5)`, [
          actorUserId, id, body.workItemId, body.reason, randomUUID(),
        ]),
      );
      return this.getCycle(actorUserId, id);
    });
  }

  notifications(actorUserId: string, unreadOnly?: boolean, limit?: number, offset?: number) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_notifications_list($1,$2,$3,$4) AS payload`, [
      actorUserId, unreadOnly ?? false, limit ?? 50, offset ?? 0,
    ]);
  }

  markRead(actorUserId: string, notificationId: string | null, all: boolean) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_notifications_mark_read($1,$2,$3) AS payload`, [
      actorUserId, notificationId, all,
    ]);
  }

  enqueueJob(actorUserId: string, body: HJobEnqueueDto) {
    return withHOperationsErrors(async () => {
      const id = await this.internal.withScope(actorUserId, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT public.internal_h_job_enqueue($1,$2,$3,$4,$5) AS id`,
          [actorUserId, body.jobType, body.idempotencyKey, JSON.stringify(body.payload ?? {}), randomUUID()],
        );
        return result.rows[0].id;
      });
      return { id };
    });
  }

  runJob(actorUserId: string, jobId: string) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_job_run($1,$2,$3) AS payload`, [
      actorUserId, jobId, randomUUID(),
    ]);
  }

  health(actorUserId: string) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_health($1) AS payload`, [actorUserId]);
  }

  getConfig(actorUserId: string) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_config_get($1) AS payload`, [actorUserId]);
  }

  setConfig(actorUserId: string, body: HConfigSetDto) {
    return this.scopeJson(actorUserId, `SELECT public.internal_h_config_set($1,$2,$3,$4) AS payload`, [
      actorUserId, body.key, JSON.stringify(body.value), randomUUID(),
    ]);
  }

  auditEvidence(actorUserId: string, query: Record<string, string | undefined>) {
    return this.scopeJson(
      actorUserId,
      `SELECT public.internal_h_audit_evidence($1,$2,$3,$4,$5,$6,$7,$8) AS payload`,
      [
        actorUserId,
        query.domain ?? null,
        query.entityId ?? null,
        query.action ?? null,
        query.from ?? null,
        query.to ?? null,
        Number(query.limit ?? 50),
        Number(query.offset ?? 0),
      ],
    );
  }
}
