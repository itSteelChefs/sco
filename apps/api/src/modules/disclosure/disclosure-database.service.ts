import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { InternalDatabaseService } from '../../database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../database/runtime-database.service.js';
import { PurposeDecisionAuthorityService } from '../rbac/purpose-decision-authority.service.js';
import type { DisclosureResourceType, IdentityClass, RecipientContext } from './disclosure.types.js';

@Injectable()
export class DisclosureDatabaseService {
  constructor(
    @Inject(RuntimeDatabaseService) private readonly runtime: RuntimeDatabaseService,
    @Inject(InternalDatabaseService) private readonly internal: InternalDatabaseService,
    @Inject(PurposeDecisionAuthorityService) private readonly purposeDecisions: PurposeDecisionAuthorityService,
  ) {}

  async createAlias(actorUserId: string, input: {
    ownerCompanyId: string;
    recipientCompanyId: string;
    recipientContext: RecipientContext;
    resourceType: DisclosureResourceType;
    resourceId: string;
    identityClass: IdentityClass;
    subjectReference: string;
    alias: string;
  }): Promise<string> {
    const result = await this.internal.createDisclosureAlias(actorUserId, input);
    return result.id;
  }

  async retireAlias(actorUserId: string, aliasId: string): Promise<void> {
    await this.internal.retireDisclosureAlias(actorUserId, aliasId);
  }

  async withAuthorizedAlias<T>(actorUserId: string, recipientCompanyId: string, input: {
    resourceType: DisclosureResourceType;
    resourceId: string;
    identityClass: IdentityClass;
    subjectReference: string;
  }, callback: (client: PoolClient, alias: string | null) => Promise<T>): Promise<T> {
    return this.runtime.withActor(actorUserId, async (client) => {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [recipientCompanyId]);
      const binding = (await client.query<{ backend_pid: number; transaction_id: string }>('SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id')).rows[0];
      const decisionId = await this.purposeDecisions.issueDisclosureFixtureRead(actorUserId, recipientCompanyId, input.resourceId, input.subjectReference);
      await this.purposeDecisions.consumeDisclosureFixtureRead(decisionId, actorUserId, recipientCompanyId, input.resourceId, input.subjectReference, binding.backend_pid, binding.transaction_id);
      await client.query("SELECT set_config('app.disclosure_purpose_decision', $1, true)", [decisionId]);
      const result = await client.query<{ alias: string | null }>(
        'SELECT public.disclosure_alias_present($1,$2,$3,$4,$5,$6) AS alias',
        [actorUserId, recipientCompanyId, input.resourceType, input.resourceId, input.identityClass, input.subjectReference],
      );
      return callback(client, result.rows[0]?.alias ?? null);
    });
  }
}
