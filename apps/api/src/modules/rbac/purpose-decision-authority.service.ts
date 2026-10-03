import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class PurposeDecisionAuthorityService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.PURPOSE_AUTHORITY_DATABASE_URL;
    if (!connectionString) throw new Error('PURPOSE_AUTHORITY_DATABASE_URL is required.');
    this.pool = new Pool({ connectionString, max: 2 });
  }

  async issuePartnerVerifyRead(actorUserId: string, companyId: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      'SELECT public.issue_partner_verify_read_purpose_decision($1, $2) AS id',
      [actorUserId, companyId],
    );
    if (!result.rows[0]?.id) throw new Error('Purpose decision issuance failed.');
    return result.rows[0].id;
  }

  async consumePartnerVerifyRead(decisionId: string, actorUserId: string, companyId: string, backendPid: number, transactionId: string): Promise<void> {
    await this.pool.query(
      'SELECT public.consume_partner_verify_read_purpose_decision($1, $2, $3, $4, $5::bigint)',
      [decisionId, actorUserId, companyId, backendPid, transactionId],
    );
  }

  async issueDisclosureFixtureRead(actorUserId: string, companyId: string, resourceId: string, subjectReference: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      'SELECT public.issue_disclosure_fixture_purpose_decision($1,$2,$3,$4) AS id',
      [actorUserId, companyId, resourceId, subjectReference],
    );
    if (!result.rows[0]?.id) throw new Error('Disclosure purpose decision issuance failed.');
    return result.rows[0].id;
  }

  async consumeDisclosureFixtureRead(decisionId: string, actorUserId: string, companyId: string, resourceId: string, subjectReference: string, backendPid: number, transactionId: string): Promise<void> {
    await this.pool.query(
      'SELECT public.consume_disclosure_fixture_purpose_decision($1,$2,$3,$4,$5,$6,$7::bigint)',
      [decisionId, actorUserId, companyId, resourceId, subjectReference, backendPid, transactionId],
    );
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}