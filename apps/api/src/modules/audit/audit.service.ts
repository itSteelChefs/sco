import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';
import { TenantTransactionService } from '../../database/tenant-transaction.service.js';
import type { AuditEvent } from './audit-event.js';

const forbiddenKeys = /password|token|secret|credential|authorization|cookie|storage.?key|raw.?content|document.?bytes/i;
function safeMetadata(value: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbiddenKeys.test(key)));
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(RuntimeDatabaseService) private readonly database: RuntimeDatabaseService,
    @Inject(TenantTransactionService) private readonly tenants: TenantTransactionService,
  ) {}

  private values(event: AuditEvent) {
    return [
      event.actorUserId ?? null,
      event.companyId ?? null,
      event.scope,
      event.action,
      event.entityType ?? null,
      event.entityId ?? null,
      JSON.stringify(safeMetadata(event.metadata)),
      event.correlationId ?? null,
      event.purposeCode ?? null,
      event.flowSource ?? null,
      event.flowTarget ?? null,
      event.authorizationDecision ?? null,
    ];
  }

  private insert(client: PoolClient, event: AuditEvent): Promise<unknown> {
    return client.query(
      `INSERT INTO audit_logs (actor_user_id, company_id, scope, action, entity_type, entity_id, metadata, correlation_id, purpose_code, flow_source, flow_target, authorization_decision)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)`,
      this.values(event),
    );
  }

  async recordInTenantTransaction(client: PoolClient, event: AuditEvent): Promise<void> {
    if (event.scope !== 'TENANT' || !event.actorUserId || !event.companyId) throw new Error('TENANT_AUDIT_CONTEXT_REQUIRED');
    await this.insert(client, event);
  }

  async record(event: AuditEvent): Promise<void> {
    if (event.scope === 'TENANT') {
      if (!event.actorUserId || !event.companyId) throw new Error('TENANT_AUDIT_CONTEXT_REQUIRED');
      await this.tenants.withTenant(event.actorUserId, event.companyId, (client) => this.insert(client, event));
      return;
    }
    await this.database.withTransaction(async (client) => {
      await client.query("SELECT set_config('app.audit_system', 'true', true)");
      await this.insert(client, event);
    });
  }
}
