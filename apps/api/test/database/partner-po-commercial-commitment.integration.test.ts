import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool, PoolClient } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();

let internal: InternalDatabaseService;
let runtime: RuntimeDatabaseService;
let sco: string; let partnerA: string; let partnerB: string; let supplier: string;
let creator: string; let pricingApprover: string; let offerApprover: string; let issuer: string; let verifier: string;
let partnerAActor: string; let partnerBActor: string; let supplierActor: string; let dualRoleActor: string;
let product: string; let unit: string; let approvedPricing: string;

async function addUser(user: string) {
  await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [user, `${user}@batch93.test`]);
}

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

async function accept(actor: string, company: string, offerId: string, revisionId: string) {
  const client = await (new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL })).connect();
  try {
    await client.query('BEGIN'); await client.query("SELECT set_config('app.tenant_id',$1,true)", [company]);
    const result = await client.query('SELECT public.partner_offer_accept($1,$2,$3,$4,$5) AS accepted', [actor, company, offerId, revisionId, id()]);
    await client.query('COMMIT'); return result.rows[0].accepted;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function createAcceptedOffer() {
  const offer = await internal.createOffer(creator, { pricingRevisionId: approvedPricing, offerReference: `SCO-${id()}`, paymentTerms: 'Net 30', deliveryTerms: 'DAP', correlationId: id() });
  await internal.submitOffer(creator, offer.revisionId, id());
  await internal.decideOffer(offerApprover, offer.revisionId, 'APPROVED', undefined, id());
  await internal.issueOffer(issuer, offer.revisionId, '2099-12-31', id());
  await accept(partnerAActor, partnerA, offer.offerId, offer.revisionId);
  return offer;
}

function poInput(offer: { offerId: string; revisionId: string }, overrides: Record<string, unknown> = {}) {
  return {
    offerId: offer.offerId, offerRevisionId: offer.revisionId, reference: `PO-${id()}`, poDate: '2026-09-24', currency: 'USD',
    totalExclTax: 100, taxAmount: 0, totalInclTax: 100, paymentTerms: 'Net 30', deliveryTerms: 'DAP', administrativeMetadata: { buyerName: 'Different admin contact', costCenter: 'CC-9' },
    lines: [{ lineNumber: 1, productIdentityId: product, productDescription: 'Maker Brand Model', quantity: 5, unitId: unit, unitSellingPrice: 20, taxTreatmentCode: null, taxRate: null, taxAmount: 0, amountExclTax: 100, amountInclTax: 100 }], ...overrides,
  };
}

async function submit(input: ReturnType<typeof poInput>, actor = partnerAActor, company = partnerA) {
  return runtime.submitPartnerPurchaseOrder(actor, company, input);
}

async function projection(actor: string, company: string, poId: string) {
  return runtime.getPartnerPurchaseOrder(actor, company, poId);
}

async function commitmentProjection(actor: string, company: string, commitmentId: string) {
  return runtime.getCommercialCommitment(actor, company, commitmentId);
}

describe('Partner PO and Commercial Commitment', () => {
  beforeAll(async () => {
    sco = id(); partnerA = id(); partnerB = id(); supplier = id();
    creator = id(); pricingApprover = id(); offerApprover = id(); issuer = id(); verifier = id();
    partnerAActor = id(); partnerBActor = id(); supplierActor = id(); dualRoleActor = id();
    for (const user of [creator, pricingApprover, offerApprover, issuer, verifier, partnerAActor, partnerBActor, supplierActor, dualRoleActor]) await addUser(user);
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'SCO 9.3\',\'SCO\'),($2,\'Partner A 9.3\',\'PARTNER\'),($3,\'Partner B 9.3\',\'PARTNER\'),($4,\'Supplier 9.3\',\'SUPPLIER\')', [sco, partnerA, partnerB, supplier]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\'),($4,$5,$6,\'ACTIVE\'),($7,$8,$9,\'ACTIVE\'),($10,$11,$12,\'ACTIVE\')', [id(), partnerAActor, partnerA, id(), partnerBActor, partnerB, id(), supplierActor, supplier, id(), dualRoleActor, supplier]);
    await grant(creator, sco, 'pricing.create'); await grant(pricingApprover, sco, 'pricing.approve'); await grant(creator, sco, 'offer.create'); await grant(offerApprover, sco, 'offer.approve'); await grant(issuer, sco, 'offer.issue');
    await grant(verifier, sco, 'partner_po.verify'); await grant(verifier, sco, 'commercial_commitment.create');
    for (const actor of [partnerAActor, partnerBActor]) { await grant(actor, actor === partnerAActor ? partnerA : partnerB, 'offer.accept'); await grant(actor, actor === partnerAActor ? partnerA : partnerB, 'partner_po.submit'); await grant(actor, actor === partnerAActor ? partnerA : partnerB, 'partner_po.read'); await grant(actor, actor === partnerAActor ? partnerA : partnerB, 'commercial_commitment.read'); }
    const category = id(); unit = id(); product = id();
    await owner.query('INSERT INTO product_categories(id,code,name) VALUES($1,$2,\'PO\')', [category, `po-${category}`]);
    await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Each\',\'count\')', [unit, `po-${unit}`]);
    await owner.query('INSERT INTO product_identities(id,category_id,unit_id,created_by,status,brand,manufacturer,model_reference) VALUES($1,$2,$3,$4,\'ACTIVE\',\'Brand\',\'Maker\',\'Model\')', [product, category, unit, creator]);
    const project = id(); const need = id(); const cycle = id(); const execution = id(); const executionItem = id(); const rfq = id(); const rfqItem = id(); const partnership = id(); const source = id(); const quote = id(); const quoteRevision = id(); const snapshot = id();
    await owner.query('INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,\'PO\',\'PO\',\'ACTIVE\',$3)', [project, partnerA, creator]);
    await owner.query('INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,\'MANUAL\',$5,\'po\',5,$6,current_date,\'READY\',\'APPROVED\')', [need, partnerA, project, creator, product, unit]);
    await owner.query('INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,\'po\',now(),now(),\'PROCESSING\')', [cycle, `po-${cycle}`]);
    await owner.query('INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,\'SOURCING_READY\',$3)', [execution, cycle, creator]);
    await owner.query('INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,5,5,$7,current_date,$8,$9,\'SOURCING_READY\')', [executionItem, execution, partnerA, project, need, product, unit, id(), creator]);
    await owner.query('INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,\'EVALUATION\')', [rfq, creator]);
    await owner.query('INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,5,$8)', [rfqItem, rfq, executionItem, partnerA, project, need, product, unit]);
    await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [partnership, supplier]);
    const sourceType = (await owner.query('SELECT id FROM purchase_source_type_definitions LIMIT 1')).rows[0].id;
    await owner.query('INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,created_by) VALUES($1,$2,$3,$4,$5,$6)', [source, supplier, partnership, `po-${source}`, sourceType, creator]);
    await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)', [quote, rfq, source, supplier, creator]);
    await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code,valid_until) VALUES($1,$2,1,$3,\'USD\',\'2099-12-31\')', [quoteRevision, quote, creator]);
    await owner.query('INSERT INTO approved_purchase_cost_snapshots(id,rfq_item_id,supplier_quote_revision_id,purchase_source_id,supplier_company_id,product_identity_id,approved_quantity,currency_code,unit_purchase_cost,amount_excl_tax,amount_incl_tax,status,approved_by,approved_at,approval_reason,created_by) VALUES($1,$2,$3,$4,$5,$6,5,\'USD\',10,50,50,\'APPROVED\',$7,now(),\'fixture\',$7)', [snapshot, rfqItem, quoteRevision, source, supplier, product, creator]);
    internal = new InternalDatabaseService(); runtime = new RuntimeDatabaseService();
    const pricing = await internal.createPricing(creator, { partnerCompanyId: partnerA, currency: 'USD', lines: [{ lineNumber: 1, productIdentityId: product, quantity: 5, unitId: unit, unitSellingPrice: 20, allocations: [{ snapshotId: snapshot, quantity: 5 }] }], correlationId: id() });
    approvedPricing = pricing.revisionId; await internal.submitPricing(creator, approvedPricing, id()); await internal.decidePricing(pricingApprover, approvedPricing, 'APPROVED', undefined, false, id());
  });

  afterAll(async () => { await internal?.onModuleDestroy(); await runtime?.onModuleDestroy(); await owner.end(); });

  it('authorized Partner submits an accepted-offer PO and preserves exact revision', async () => {
    const offer = await createAcceptedOffer(); const poId = await submit(poInput(offer));
    expect(poId).toBeTruthy(); expect(await projection(partnerAActor, partnerA, poId)).toMatchObject({ id: poId, offerRevisionId: offer.revisionId, status: 'RECEIVED' });
    expect((await owner.query('SELECT accepted_offer_revision_id,submitted_by FROM partner_purchase_orders WHERE id=$1', [poId])).rows[0]).toMatchObject({ accepted_offer_revision_id: offer.revisionId, submitted_by: partnerAActor });
  });

  it('rejects wrong tenant, unauthorized Partner, supplier, dual-role, nonaccepted, random, and duplicate submissions', async () => {
    const offer = await createAcceptedOffer(); const input = poInput(offer);
    await expect(submit(input, partnerBActor, partnerB)).rejects.toThrow('PARTNER_PO_NOT_AVAILABLE');
    await expect(submit(input, supplierActor, supplier)).rejects.toThrow('PARTNER_PO_NOT_AVAILABLE');
    await expect(submit(input, dualRoleActor, partnerA)).rejects.toThrow('PARTNER_PO_NOT_AVAILABLE');
    await expect(submit({ ...input, offerId: id(), offerRevisionId: id() })).rejects.toThrow('PARTNER_PO_NOT_AVAILABLE');
    const poId = await submit(input); await expect(submit(input)).rejects.toThrow('PARTNER_PO_ALREADY_EXISTS');
    expect((await owner.query('SELECT count(*)::int AS count FROM partner_purchase_orders WHERE accepted_offer_revision_id=$1', [offer.revisionId])).rows[0].count).toBe(1);
    const draft = await internal.createOffer(creator, { pricingRevisionId: approvedPricing, offerReference: `DRAFT-${id()}`, correlationId: id() });
    await expect(submit(poInput({ offerId: draft.offerId, revisionId: draft.revisionId }))).rejects.toThrow('PARTNER_PO_NOT_AVAILABLE');
    expect(poId).toBeTruthy();
  });

  it('ignores administrative differences but detects material commercial differences', async () => {
    const cases = [
      ['quantity', { lines: [{ lineNumber: 1, productIdentityId: product, productDescription: 'Maker Brand Model', quantity: 6, unitId: unit, unitSellingPrice: 20, taxAmount: 0, amountExclTax: 120, amountInclTax: 120 }] }],
      ['unit_price', { lines: [{ lineNumber: 1, productIdentityId: product, productDescription: 'Maker Brand Model', quantity: 5, unitId: unit, unitSellingPrice: 21, taxAmount: 0, amountExclTax: 105, amountInclTax: 105 }] }],
      ['total', { totalExclTax: 101, totalInclTax: 101 }], ['tax', { taxAmount: 1, totalInclTax: 101 }], ['currency', { currency: 'EUR' }], ['payment', { paymentTerms: 'Due on receipt' }], ['delivery', { deliveryTerms: 'EXW' }],
    ] as const;
    for (const [code, overrides] of cases) { const offer = await createAcceptedOffer(); const poId = await submit(poInput(offer, overrides)); const result = await internal.verifyPartnerPurchaseOrder(verifier, poId, 'reviewed', id()); expect(result.outcome).toBe('MATERIAL_DIFFERENCE'); expect((await owner.query('SELECT material_differences FROM partner_purchase_order_verifications WHERE id=$1', [result.verification_id])).rows[0].material_differences).toContain(code === 'quantity' ? 'product_or_quantity' : code === 'payment' || code === 'delivery' ? 'commercial_terms' : code); }
    const adminOffer = await createAcceptedOffer(); const adminPo = await submit(poInput(adminOffer, { administrativeMetadata: { buyerName: 'Other', costCenter: 'CC-99', notes: 'admin only' } })); const adminResult = await internal.verifyPartnerPurchaseOrder(verifier, adminPo, undefined, id()); expect(adminResult.outcome).toBe('MATCHED');
  });

  it('material difference cannot create a commitment and failed verification has no success audit', async () => {
    const offer = await createAcceptedOffer(); const poId = await submit(poInput(offer, { totalExclTax: 101, totalInclTax: 101 }));
    await expect(internal.verifyPartnerPurchaseOrder(partnerAActor, poId)).rejects.toThrow('PARTNER_PO_VERIFY_FORBIDDEN');
    const result = await internal.verifyPartnerPurchaseOrder(verifier, poId, 'material total mismatch', id());
    await expect(internal.createCommercialCommitment(verifier, poId, id())).rejects.toThrow('COMMERCIAL_COMMITMENT_NOT_ELIGIBLE');
    expect((await owner.query("SELECT count(*)::int AS count FROM audit_logs WHERE entity_id=$1 AND action='commercial_commitment.created'", [poId])).rows[0].count).toBe(0);
    expect(result.outcome).toBe('MATERIAL_DIFFERENCE');
  });

  it('matched verification creates one immutable commitment snapshot and preserves history', async () => {
    const offer = await createAcceptedOffer(); const poId = await submit(poInput(offer)); const verification = await internal.verifyPartnerPurchaseOrder(verifier, poId, undefined, id());
    expect(verification.outcome).toBe('MATCHED'); const commitmentId = await internal.createCommercialCommitment(verifier, poId, id());
    expect(commitmentId).toBeTruthy(); expect(await commitmentProjection(partnerAActor, partnerA, commitmentId)).toMatchObject({ offerRevisionId: offer.revisionId, purchaseOrderId: poId, status: 'COMMITTED' });
    expect(JSON.stringify(await commitmentProjection(partnerAActor, partnerA, commitmentId))).not.toMatch(/purchaseCost|purchaseSource|supplier|margin|overhead|contribution|directCost|pricingRevision/i);
    await expect(owner.query('UPDATE commercial_commitments SET total_excl_tax=0 WHERE id=$1', [commitmentId])).rejects.toThrow('PARTNER_PO_HISTORY_IMMUTABLE');
    await expect(owner.query('UPDATE partner_purchase_orders SET po_reference=\'changed\' WHERE id=$1', [poId])).rejects.toThrow('PARTNER_PO_HISTORY_IMMUTABLE');
    await expect(internal.createCommercialCommitment(verifier, poId, id())).rejects.toThrow('COMMERCIAL_COMMITMENT_ALREADY_EXISTS');
  });

  it('prevents concurrent commitment duplication and isolates Partner B and suppliers', async () => {
    const offer = await createAcceptedOffer(); const poId = await submit(poInput(offer)); await internal.verifyPartnerPurchaseOrder(verifier, poId, undefined, id());
    const results = await Promise.allSettled([internal.createCommercialCommitment(verifier, poId, id()), internal.createCommercialCommitment(verifier, poId, id())]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const commitmentId = (await owner.query('SELECT id FROM commercial_commitments WHERE partner_purchase_order_id=$1', [poId])).rows[0].id;
    expect(await commitmentProjection(partnerBActor, partnerB, commitmentId)).toBeNull(); expect(await commitmentProjection(supplierActor, supplier, commitmentId)).toBeNull(); expect(await projection(partnerBActor, partnerB, poId)).toBeNull();
  });

  it('enforces RLS, FORCE RLS, direct-DML denial, PUBLIC EXECUTE revocation, and GUC fail-closed behavior', async () => {
    for (const table of ['partner_purchase_orders', 'partner_purchase_order_lines', 'partner_purchase_order_verifications', 'commercial_commitments', 'commercial_commitment_lines']) { const row = (await owner.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [table])).rows[0]; expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true }); }
    const runtimeClient = new Client({ connectionString: process.env.RUNTIME_DATABASE_URL }); await runtimeClient.connect();
    try { await expect(runtimeClient.query('INSERT INTO partner_purchase_orders(partner_company_id,accepted_offer_id,accepted_offer_revision_id,po_reference,po_date,submitted_by,currency_code,total_excl_tax,total_incl_tax) VALUES($1,$2,$3,$4,current_date,$5,\'USD\',1,1)', [partnerA, id(), id(), `blocked-${id()}`, partnerAActor])).rejects.toThrow(/permission denied/i); } finally { await runtimeClient.end(); }
    const publicExecute = await owner.query("SELECT routine_name,has_function_privilege('public',CASE routine_name WHEN 'partner_po_submit' THEN 'public.partner_po_submit(uuid,uuid,uuid,uuid,text,date,text,numeric,numeric,numeric,text,text,jsonb,jsonb,text)' WHEN 'internal_partner_po_verify' THEN 'public.internal_partner_po_verify(uuid,uuid,text,text)' WHEN 'internal_commercial_commitment_create' THEN 'public.internal_commercial_commitment_create(uuid,uuid,text)' WHEN 'partner_purchase_order_projection' THEN 'public.partner_purchase_order_projection(uuid,uuid,uuid)' ELSE 'public.commercial_commitment_projection(uuid,uuid,uuid)' END,'EXECUTE') AS allowed FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('partner_po_submit','internal_partner_po_verify','internal_commercial_commitment_create','partner_purchase_order_projection','commercial_commitment_projection')"); expect(publicExecute.rows).toHaveLength(5); expect(publicExecute.rows.every((row) => row.allowed === false)).toBe(true);
    const executor = new Client({ connectionString: process.env.SCO_INTERNAL_DATABASE_URL }); await executor.connect(); try { await executor.query("SELECT set_config('app.partner_po_gateway','true',true),set_config('app.sco_internal','true',true)"); await expect(executor.query('UPDATE commercial_commitments SET total_excl_tax=0 WHERE false')).rejects.toThrow(/permission denied/i); } finally { await executor.end(); }
  });
});
