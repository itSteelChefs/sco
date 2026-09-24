import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool, PoolClient } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const runtime = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL });
const id = () => randomUUID();

let internal: InternalDatabaseService;
let sco: string; let partnerA: string; let partnerB: string; let supplier: string;
let creator: string; let approver: string; let issuer: string; let withdrawer: string; let unauthorized: string;
let partnerAActor: string; let partnerBActor: string; let supplierActor: string; let dualRoleActor: string;
let product: string; let unit: string; let snapshot: string; let approvedPricing: string;

async function grant(user: string, company: string, code: string) {
  let membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [user, company])).rows[0]?.id;
  if (!membership) {
    membership = id();
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [membership, user, company]);
  }
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, company, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), company, membership, role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4', [id(), company, role, code]);
}

async function addUser(user: string) {
  await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [user, `${user}@offer.test`]);
}

async function createPricing() {
  const pricing = await internal.createPricing(creator, { partnerCompanyId: partnerA, currency: 'USD', lines: [{ lineNumber: 1, productIdentityId: product, quantity: 5, unitId: unit, unitSellingPrice: 20, allocations: [{ snapshotId: snapshot, quantity: 5 }] }], correlationId: id() });
  await internal.submitPricing(creator, pricing.revisionId, id());
  await internal.decidePricing(approver, pricing.revisionId, 'APPROVED', undefined, false, id());
  return pricing.revisionId;
}

async function createOffer(pricingRevisionId = approvedPricing, actor = creator, offerId?: string) {
  return internal.createOffer(actor, { offerId, pricingRevisionId, offerReference: `SCO-${id()}`, commercialTerms: 'Net 30', correlationId: id() });
}

async function prepareOffer() {
  const offer = await createOffer();
  await internal.submitOffer(creator, offer.revisionId, id());
  await internal.decideOffer(approver, offer.revisionId, 'APPROVED', undefined, id());
  return offer;
}

async function withRuntime<T>(tenant: string, action: (client: PoolClient) => Promise<T>) {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config(\'app.tenant_id\',$1,true)', [tenant]);
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function projection(actor: string, company: string, revision: string) {
  return withRuntime(company, async (client) => (await client.query('SELECT public.partner_offer_projection($1,$2,$3) AS projection', [actor, company, revision])).rows[0].projection);
}

async function accept(actor: string, company: string, offer: string, revision: string, correlation = id()) {
  return withRuntime(company, async (client) => (await client.query('SELECT public.partner_offer_accept($1,$2,$3,$4,$5) AS accepted', [actor, company, offer, revision, correlation])).rows[0].accepted);
}

async function setExpired(revision: string) {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.offer_gateway','true',true)");
    await client.query('UPDATE partner_offer_revisions SET valid_until=current_date-1 WHERE id=$1', [revision]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('Partner offer revisions', () => {
  beforeAll(async () => {
    sco = id(); partnerA = id(); partnerB = id(); supplier = id();
    creator = id(); approver = id(); issuer = id(); withdrawer = id(); unauthorized = id();
    partnerAActor = id(); partnerBActor = id(); supplierActor = id(); dualRoleActor = id();
    for (const user of [creator, approver, issuer, withdrawer, unauthorized, partnerAActor, partnerBActor, supplierActor, dualRoleActor]) await addUser(user);
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'SCO offer\',\'SCO\'),($2,\'Partner A offer\',\'PARTNER\'),($3,\'Partner B offer\',\'PARTNER\'),($4,\'Supplier offer\',\'SUPPLIER\')', [sco, partnerA, partnerB, supplier]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\'),($4,$5,$6,\'ACTIVE\'),($7,$8,$9,\'ACTIVE\'),($10,$11,$12,\'ACTIVE\')', [id(), partnerAActor, partnerA, id(), partnerBActor, partnerB, id(), supplierActor, supplier, id(), dualRoleActor, supplier]);
    await grant(creator, sco, 'pricing.create'); await grant(creator, sco, 'offer.create'); await grant(creator, sco, 'offer.read'); await grant(approver, sco, 'pricing.approve'); await grant(approver, sco, 'offer.approve'); await grant(issuer, sco, 'offer.issue'); await grant(withdrawer, sco, 'offer.withdraw');
    await grant(partnerAActor, partnerA, 'offer.partner_read'); await grant(partnerAActor, partnerA, 'offer.accept'); await grant(partnerBActor, partnerB, 'offer.partner_read'); await grant(partnerBActor, partnerB, 'offer.accept');
    const category = id(); unit = id(); product = id();
    await owner.query('INSERT INTO product_categories(id,code,name) VALUES($1,$2,\'Offer\')', [category, `offer-${category}`]);
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Each\',\'count\')', [unit, `offer-${unit}`]);
    await owner.query('INSERT INTO product_identities(id,category_id,unit_id,created_by,status,brand,manufacturer,model_reference) VALUES($1,$2,$3,$4,\'ACTIVE\',\'Brand\',\'Maker\',\'Model\')', [product, category, unit, creator]);
    const project = id(); const need = id(); const cycle = id(); const execution = id(); const executionItem = id(); const rfq = id(); const rfqItem = id(); const partnership = id(); const source = id(); const quote = id(); const quoteRevision = id(); snapshot = id();
    await owner.query('INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,\'OFFER\',\'Offer\',\'ACTIVE\',$3)', [project, partnerA, creator]);
    await owner.query('INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,\'MANUAL\',$5,\'offer\',5,$6,current_date,\'READY\',\'APPROVED\')', [need, partnerA, project, creator, product, unit]);
    await owner.query('INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,\'offer\',now(),now(),\'PROCESSING\')', [cycle, `offer-${cycle}`]);
    await owner.query('INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,\'SOURCING_READY\',$3)', [execution, cycle, creator]);
    await owner.query('INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,5,5,$7,current_date,$8,$9,\'SOURCING_READY\')', [executionItem, execution, partnerA, project, need, product, unit, id(), creator]);
    await owner.query('INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,\'EVALUATION\')', [rfq, creator]);
    await owner.query('INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,5,$8)', [rfqItem, rfq, executionItem, partnerA, project, need, product, unit]);
    await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [partnership, supplier]);
    const sourceType = (await owner.query('SELECT id FROM purchase_source_type_definitions LIMIT 1')).rows[0].id;
    await owner.query('INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,created_by) VALUES($1,$2,$3,$4,$5,$6)', [source, supplier, partnership, `offer-${source}`, sourceType, creator]);
    await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)', [quote, rfq, source, supplier, creator]);
    await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code,valid_until) VALUES($1,$2,1,$3,\'USD\',\'2099-12-31\')', [quoteRevision, quote, creator]);
    await owner.query('INSERT INTO approved_purchase_cost_snapshots(id,rfq_item_id,supplier_quote_revision_id,purchase_source_id,supplier_company_id,product_identity_id,approved_quantity,currency_code,unit_purchase_cost,amount_excl_tax,amount_incl_tax,status,approved_by,approved_at,approval_reason,created_by) VALUES($1,$2,$3,$4,$5,$6,5,\'USD\',10,50,50,\'APPROVED\',$7,now(),\'fixture\',$7)', [snapshot, rfqItem, quoteRevision, source, supplier, product, creator]);
    internal = new InternalDatabaseService();
    approvedPricing = await createPricing();
  });

  afterAll(async () => { await internal?.onModuleDestroy(); await owner.end(); await runtime.end(); });

  it('creates an authorized draft and preserves the exact approved pricing binding', async () => {
    const offer = await createOffer();
    expect(offer.offerId).toBeTruthy(); expect(offer.revisionId).toBeTruthy();
    expect(await internal.getOfferBinding(creator, offer.revisionId)).toEqual({ pricing_revision_id: approvedPricing });
    expect((await owner.query('SELECT status,created_by FROM partner_offer_revisions WHERE id=$1', [offer.revisionId])).rows[0]).toMatchObject({ status: 'DRAFT', created_by: creator });
  });

  it('rejects unauthorized creation and creation from an unapproved pricing revision', async () => {
    await expect(createOffer(approvedPricing, unauthorized)).rejects.toThrow('OFFER_CREATE_FORBIDDEN');
    const draft = await internal.createPricing(creator, { partnerCompanyId: partnerA, currency: 'USD', lines: [{ lineNumber: 1, productIdentityId: product, quantity: 5, unitId: unit, unitSellingPrice: 20, allocations: [{ snapshotId: snapshot, quantity: 5 }] }], correlationId: id() });
    await expect(createOffer(draft.revisionId)).rejects.toThrow('OFFER_PRICING_NOT_APPROVED');
  });

  it('enforces submit, rejection reason, separation of duties, and independent approval', async () => {
    const offer = await createOffer();
    await expect(internal.decideOffer(creator, offer.revisionId, 'APPROVED')).rejects.toThrow('OFFER_APPROVAL_FORBIDDEN');
    await internal.submitOffer(creator, offer.revisionId, id());
    await expect(internal.decideOffer(approver, offer.revisionId, 'REJECTED', '  ', id())).rejects.toThrow('OFFER_REJECTION_REASON_REQUIRED');
    expect((await owner.query("SELECT count(*)::int AS count FROM audit_logs WHERE entity_id=$1 AND action='offer.revision_rejected'", [offer.revisionId])).rows[0].count).toBe(0);
    await internal.decideOffer(approver, offer.revisionId, 'REJECTED', 'commercial review', id());
    expect((await owner.query('SELECT status FROM partner_offer_revisions WHERE id=$1', [offer.revisionId])).rows[0].status).toBe('REJECTED');
    const approved = await prepareOffer();
    expect((await owner.query('SELECT status FROM partner_offer_revisions WHERE id=$1', [approved.revisionId])).rows[0].status).toBe('INTERNALLY_APPROVED');
  });

  it('requires a valid supporting commercial basis and valid_until at issuance', async () => {
    const offer = await prepareOffer();
    await expect(internal.issueOffer(issuer, offer.revisionId, new Date(Date.now() - 86400000).toISOString().slice(0, 10), id())).rejects.toThrow('OFFER_VALID_UNTIL_REQUIRED');
    await expect(internal.issueOffer(issuer, offer.revisionId, '2100-01-01', id())).rejects.toThrow('OFFER_VALIDITY_NOT_SUPPORTED');
    await internal.issueOffer(issuer, offer.revisionId, '2099-12-31', id());
    expect((await owner.query('SELECT status,valid_until FROM partner_offer_revisions WHERE id=$1', [offer.revisionId])).rows[0]).toMatchObject({ status: 'ISSUED' });
    expect((await owner.query('SELECT valid_until::text FROM partner_offer_revisions WHERE id=$1', [offer.revisionId])).rows[0].valid_until).toBe('2099-12-31');
  });

  it('projects only partner-safe fields and isolates Partner A from Partner B, suppliers, and dual-role users', async () => {
    const offer = await prepareOffer();
    const view = await projection(partnerAActor, partnerA, offer.revisionId);
    expect(view).toMatchObject({ offerId: offer.offerId, revisionId: offer.revisionId, status: 'INTERNALLY_APPROVED' });
    expect(JSON.stringify(view)).not.toMatch(/pricing|purchase|supplier|source|margin|overhead|contribution|approvalReason/i);
    expect(await projection(partnerBActor, partnerB, offer.revisionId)).toBeNull();
    expect(await projection(partnerAActor, partnerB, offer.revisionId)).toBeNull();
    expect(await projection(supplierActor, supplier, offer.revisionId)).toBeNull();
    expect(await projection(dualRoleActor, partnerA, offer.revisionId)).toBeNull();
  });

  it('does not expose an existence oracle for unauthorized or random revisions', async () => {
    const offer = await prepareOffer();
    expect(await projection(partnerBActor, partnerB, offer.revisionId)).toBeNull();
    expect(await projection(partnerBActor, partnerB, id())).toBeNull();
  });

  it('accepts the exact issued revision only for the owning authorized partner', async () => {
    const offer = await prepareOffer(); await internal.issueOffer(issuer, offer.revisionId, '2099-12-31', id());
    const correlation = id();
    await expect(accept(partnerBActor, partnerB, offer.offerId, offer.revisionId)).rejects.toThrow('OFFER_NOT_AVAILABLE');
    await expect(accept(unauthorized, partnerA, offer.offerId, offer.revisionId)).rejects.toThrow('OFFER_NOT_AVAILABLE');
    await expect(accept(partnerAActor, partnerA, id(), offer.revisionId)).rejects.toThrow('OFFER_NOT_AVAILABLE');
    await expect(accept(partnerAActor, partnerA, offer.offerId, id())).rejects.toThrow('OFFER_NOT_AVAILABLE');
    expect(await accept(partnerAActor, partnerA, offer.offerId, offer.revisionId, correlation)).toBe(true);
    expect((await owner.query('SELECT status,accepted_by FROM partner_offer_revisions WHERE id=$1', [offer.revisionId])).rows[0]).toMatchObject({ status: 'ACCEPTED', accepted_by: partnerAActor });
    expect((await owner.query("SELECT correlation_id FROM audit_logs WHERE entity_id=$1 AND action='offer.accepted'", [offer.revisionId])).rows[0].correlation_id).toBe(correlation);
  });

  it('makes concurrent or repeated acceptance single-winner and single-audit', async () => {
    const offer = await prepareOffer(); await internal.issueOffer(issuer, offer.revisionId, '2099-12-31', id());
    const results = await Promise.allSettled([accept(partnerAActor, partnerA, offer.offerId, offer.revisionId), accept(partnerAActor, partnerA, offer.offerId, offer.revisionId)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await owner.query("SELECT count(*)::int AS count FROM audit_logs WHERE entity_id=$1 AND action='offer.accepted'", [offer.revisionId])).rows[0].count).toBe(1);
  });

  it('derives EXPIRED and rejects expired, withdrawn, and superseded acceptance', async () => {
    const expired = await prepareOffer(); await internal.issueOffer(issuer, expired.revisionId, '2099-12-31', id());
    await setExpired(expired.revisionId);
    expect((await projection(partnerAActor, partnerA, expired.revisionId)).status).toBe('EXPIRED');
    await expect(accept(partnerAActor, partnerA, expired.offerId, expired.revisionId)).rejects.toThrow('OFFER_NOT_AVAILABLE');
    const withdrawn = await prepareOffer(); await internal.issueOffer(issuer, withdrawn.revisionId, '2099-12-31', id()); await internal.withdrawOffer(withdrawer, withdrawn.revisionId, 'customer withdrew', id());
    await expect(accept(partnerAActor, partnerA, withdrawn.offerId, withdrawn.revisionId)).rejects.toThrow('OFFER_NOT_AVAILABLE');
    const first = await prepareOffer(); const second = await createOffer(approvedPricing, creator, first.offerId); await internal.submitOffer(creator, second.revisionId, id()); await internal.decideOffer(approver, second.revisionId, 'APPROVED', undefined, id());
    expect((await owner.query('SELECT status FROM partner_offer_revisions WHERE id=$1', [first.revisionId])).rows[0].status).toBe('SUPERSEDED');
    await internal.issueOffer(issuer, second.revisionId, '2099-12-31', id());
    await expect(accept(partnerAActor, partnerA, first.offerId, first.revisionId)).rejects.toThrow('OFFER_NOT_AVAILABLE');
  });

  it('requires withdrawal permission and a reason, and cannot withdraw accepted history', async () => {
    const offer = await prepareOffer(); await internal.issueOffer(issuer, offer.revisionId, '2099-12-31', id());
    await expect(internal.withdrawOffer(unauthorized, offer.revisionId, 'reason', id())).rejects.toThrow('OFFER_WITHDRAW_FORBIDDEN');
    await expect(internal.withdrawOffer(withdrawer, offer.revisionId, ' ', id())).rejects.toThrow('OFFER_WITHDRAWAL_REASON_REQUIRED');
    await internal.withdrawOffer(withdrawer, offer.revisionId, 'commercial withdrawal', id());
    expect((await owner.query('SELECT status,withdrawal_reason FROM partner_offer_revisions WHERE id=$1', [offer.revisionId])).rows[0]).toMatchObject({ status: 'WITHDRAWN', withdrawal_reason: 'commercial withdrawal' });
    const accepted = await prepareOffer(); await internal.issueOffer(issuer, accepted.revisionId, '2099-12-31', id()); await accept(partnerAActor, partnerA, accepted.offerId, accepted.revisionId);
    await expect(internal.withdrawOffer(withdrawer, accepted.revisionId, 'late', id())).rejects.toThrow('OFFER_NOT_WITHDRAWABLE');
  });

  it('preserves revision history and audits actual lifecycle events exactly once', async () => {
    const first = await prepareOffer(); const second = await createOffer(approvedPricing, creator, first.offerId);
    expect((await owner.query('SELECT status,superseded_by_revision_id FROM partner_offer_revisions WHERE id=$1', [first.revisionId])).rows[0]).toMatchObject({ status: 'SUPERSEDED', superseded_by_revision_id: second.revisionId });
    const actions = (await owner.query("SELECT action FROM audit_logs WHERE entity_id=$1 ORDER BY created_at", [first.revisionId])).rows.map((row) => row.action);
    expect(actions).toContain('offer.revision_created'); expect(actions).toContain('offer.revision_submitted'); expect(actions).toContain('offer.revision_approved'); expect(actions).toContain('offer.superseded');
    await expect(owner.query("UPDATE partner_offer_revisions SET offer_total_excl_tax=0 WHERE id=$1", [second.revisionId])).rejects.toThrow('OFFER_HISTORY_IMMUTABLE');
  });

  it('enforces RLS, FORCE RLS, restricted DML, PUBLIC EXECUTE revocation, and gateway fail-closed behavior', async () => {
    for (const table of ['partner_offers', 'partner_offer_revisions', 'partner_offer_lines', 'offer_internal_bindings', 'offer_approvals']) {
      const result = await owner.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [table]);
      expect(result.rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    }
    const client = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await client.connect();
    try {
      await expect(client.query('INSERT INTO partner_offers(company_id,offer_reference,created_by) VALUES($1,$2,$3)', [partnerA, `blocked-${id()}`, creator])).rejects.toThrow(/permission denied/i);
      await expect(client.query('SELECT public.internal_offer_create($1,NULL,$2,$3,NULL,NULL,NULL,NULL)', [creator, approvedPricing, `blocked-${id()}`])).rejects.toThrow(/permission denied/i);
    } finally { await client.end(); }
    const publicExecute = await owner.query("SELECT routine_name,has_function_privilege('public',CASE routine_name WHEN 'internal_offer_create' THEN 'public.internal_offer_create(uuid,uuid,uuid,text,text,text,text,text)' WHEN 'internal_offer_submit' THEN 'public.internal_offer_submit(uuid,uuid,text)' WHEN 'internal_offer_decide' THEN 'public.internal_offer_decide(uuid,uuid,text,text,text)' WHEN 'internal_offer_issue' THEN 'public.internal_offer_issue(uuid,uuid,date,text)' WHEN 'internal_offer_withdraw' THEN 'public.internal_offer_withdraw(uuid,uuid,text,text)' WHEN 'internal_offer_binding_get' THEN 'public.internal_offer_binding_get(uuid,uuid)' WHEN 'partner_offer_projection' THEN 'public.partner_offer_projection(uuid,uuid,uuid)' ELSE 'public.partner_offer_accept(uuid,uuid,uuid,uuid,text)' END,'EXECUTE') AS allowed FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('internal_offer_create','internal_offer_submit','internal_offer_decide','internal_offer_issue','internal_offer_withdraw','internal_offer_binding_get','partner_offer_projection','partner_offer_accept')");
    expect(publicExecute.rows).toHaveLength(8);
    expect(publicExecute.rows.every((row) => row.allowed === false)).toBe(true);
    const executor = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL }); await executor.connect();
    try { await executor.query("SELECT set_config('app.offer_gateway','true',true),set_config('app.sco_internal','true',true)"); await expect(executor.query('UPDATE partner_offer_revisions SET offer_total_excl_tax=0 WHERE false')).rejects.toThrow(/permission denied/i); } finally { await executor.end(); }
  });
});