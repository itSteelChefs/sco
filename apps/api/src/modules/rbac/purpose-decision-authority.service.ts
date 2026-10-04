import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

type DocumentPolicyPurposeOperation = 'POLICY_REVISE' | 'LINEAGE_CREATE';
export type ProcurementIntelligencePurposeDecision = {
  decisionId: string;
  authorizationCompanyId: string;
};

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

  async issueDocumentPolicyMutation(
    actorUserId: string,
    companyId: string,
    documentId: string,
    relatedDocumentId: string | null,
    operation: DocumentPolicyPurposeOperation,
  ): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      'SELECT public.issue_document_policy_purpose_decision($1,$2,$3,$4,$5) AS id',
      [actorUserId, companyId, documentId, relatedDocumentId, operation],
    );
    if (!result.rows[0]?.id) throw new Error('Document policy purpose decision issuance failed.');
    return result.rows[0].id;
  }

  async consumeDocumentPolicyMutation(
    decisionId: string,
    actorUserId: string,
    companyId: string,
    documentId: string,
    relatedDocumentId: string | null,
    operation: DocumentPolicyPurposeOperation,
    backendPid: number,
    transactionId: string,
  ): Promise<void> {
    await this.pool.query(
      'SELECT public.consume_document_policy_purpose_decision($1,$2,$3,$4,$5,$6,$7,$8::bigint)',
      [decisionId, actorUserId, companyId, documentId, relatedDocumentId, operation, backendPid, transactionId],
    );
  }

  async issueProcurementIntelligenceRun(
    actorUserId: string,
    sourceBuyingPowerSnapshotId: string,
  ): Promise<ProcurementIntelligencePurposeDecision> {
    const result = await this.pool.query<{
      decision_id: string;
      authorization_company_id: string;
    }>(
      'SELECT * FROM public.issue_procurement_intelligence_purpose_decision($1, $2)',
      [actorUserId, sourceBuyingPowerSnapshotId],
    );
    const row = result.rows[0];
    if (!row?.decision_id || !row.authorization_company_id) {
      throw new Error('Procurement Intelligence purpose decision issuance failed.');
    }
    return {
      decisionId: row.decision_id,
      authorizationCompanyId: row.authorization_company_id,
    };
  }

  async consumeProcurementIntelligenceRun(
    decision: ProcurementIntelligencePurposeDecision,
    actorUserId: string,
    sourceBuyingPowerSnapshotId: string,
    backendPid: number,
    transactionId: string,
  ): Promise<void> {
    await this.pool.query(
      'SELECT public.consume_procurement_intelligence_purpose_decision($1, $2, $3, $4, $5, $6::bigint)',
      [
        decision.decisionId,
        actorUserId,
        decision.authorizationCompanyId,
        sourceBuyingPowerSnapshotId,
        backendPid,
        transactionId,
      ],
    );
  }

  async issueServiceAccessOperation(
    actorUserId: string,
    targetCompanyId: string,
    serviceCode: string,
    resourceContext: string,
  ): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      'SELECT public.issue_service_access_decision($1, $2, $3, $4) AS id',
      [actorUserId, targetCompanyId, serviceCode, resourceContext],
    );
    if (!result.rows[0]?.id) throw new Error('Service access decision issuance failed.');
    return result.rows[0].id;
  }

  async consumeServiceAccessOperation(
    decisionId: string,
    actorUserId: string,
    targetCompanyId: string,
    serviceCode: string,
    resourceContext: string,
    backendPid: number,
    transactionId: string,
  ): Promise<void> {
    await this.pool.query(
      'SELECT public.consume_service_access_decision($1, $2, $3, $4, $5, $6, $7::bigint)',
      [decisionId, actorUserId, targetCompanyId, serviceCode, resourceContext, backendPid, transactionId],
    );
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}