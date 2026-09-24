import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';
import { RuntimeDatabaseService } from '../../src/database/runtime-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService; let runtime: RuntimeDatabaseService;
let sco: string; let partner: string; let otherPartner: string; let supplier: string;
let partnerActor: string; let otherActor: string; let supplierActor: string; let dualActor: string;
let requirementCreator: string; let paymentVerifier: string; let fundingManager: string; let evaluator: string; let unauthorized: string;

async function addUser(user: string) { await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [user, `${user}@batch94.test`]); }
async function grant(user: string, company: string, code: string) {
  let membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [user, company])).rows[0]?.id;
  if (!membership) { membership=id(); await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')',[membership,user,company]); }
  const role=id(); await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)',[role,company,`${code}-${role}`,code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)',[id(),company,membership,role]);
  await owner.query('INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4',[id(),company,role,code]);
}
async function commitment(total = 120000) {
  const offer=id(); const revision=id(); const po=id(); const commitmentId=id();
  await owner.query('INSERT INTO partner_offers(id,company_id,offer_reference,created_by) VALUES($1,$2,$3,$4)',[offer,partner,`O-${offer}`,requirementCreator]);
  await owner.query('INSERT INTO partner_offer_revisions(id,partner_offer_id,revision_number,status,currency_code,offer_total_excl_tax,offer_tax_amount,offer_total_incl_tax,created_by,accepted_by,accepted_at) VALUES($1,$2,1,\'ACCEPTED\',\'SAR\',$3,0,$3,$4,$5,now())',[revision,offer,total,requirementCreator,partnerActor]);
  await owner.query('INSERT INTO partner_purchase_orders(id,partner_company_id,accepted_offer_id,accepted_offer_revision_id,po_reference,po_date,submitted_by,currency_code,total_excl_tax,tax_amount,total_incl_tax,status) VALUES($1,$2,$3,$4,$5,current_date,$6,\'SAR\',$7,0,$7,\'VERIFIED\')',[po,partner,offer,revision,`PO-${po}`,partnerActor,total]);
  await owner.query('INSERT INTO commercial_commitments(id,partner_company_id,partner_purchase_order_id,accepted_offer_id,accepted_offer_revision_id,commitment_revision_number,currency_code,total_excl_tax,tax_amount,total_incl_tax,payment_terms,delivery_terms,committed_by) VALUES($1,$2,$3,$4,$5,1,\'SAR\',$6,0,$6,\'Net 30\',\'DAP\',$7)',[commitmentId,partner,po,offer,revision,total,paymentVerifier]);
  return commitmentId;
}
async function createRequirement(commitmentId: string, type: string, amount: number, currency = 'SAR') { return internal.createPaymentRequirement(requirementCreator, commitmentId, { type, amount, currency, correlationId:id() }); }
async function record(company: string, actor: string, requirementId: string, amount: number, currency = 'SAR', extra: Record<string, string> = {}) { return runtime.recordPaymentReceipt(actor, company, { requirementId, amount, currency, paymentDate:'2026-09-24', method:'TRANSFER', reference:`REF-${id()}`, idempotencyKey:id(), ...extra, correlationId:id() }); }

describe('Payments, funding, and cash exposure', () => {
  beforeAll(async () => {
    sco=id(); partner=id(); otherPartner=id(); supplier=id(); partnerActor=id(); otherActor=id(); supplierActor=id(); dualActor=id(); requirementCreator=id(); paymentVerifier=id(); fundingManager=id(); evaluator=id(); unauthorized=id();
    for (const user of [partnerActor,otherActor,supplierActor,dualActor,requirementCreator,paymentVerifier,fundingManager,evaluator,unauthorized]) await addUser(user);
    await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'SCO 9.4\',\'SCO\'),($2,\'Partner 9.4\',\'PARTNER\'),($3,\'Other Partner 9.4\',\'PARTNER\'),($4,\'Supplier 9.4\',\'SUPPLIER\')',[sco,partner,otherPartner,supplier]);
    await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\'),($4,$5,$6,\'ACTIVE\'),($7,$8,$9,\'ACTIVE\'),($10,$11,$12,\'ACTIVE\')',[id(),partnerActor,partner,id(),otherActor,otherPartner,id(),supplierActor,supplier,id(),dualActor,supplier]);
    await grant(partnerActor,partner,'payment.record'); await grant(partnerActor,partner,'payment_requirement.read');
    await grant(otherActor,otherPartner,'payment.record'); await grant(otherActor,otherPartner,'payment_requirement.read');
    await grant(requirementCreator,sco,'payment_requirement.create'); await grant(paymentVerifier,sco,'payment.verify'); await grant(fundingManager,sco,'supplier_funding.manage'); await grant(fundingManager,sco,'internal_funding.approve'); await grant(evaluator,sco,'funding.evaluate'); await grant(evaluator,sco,'supplier_funding.read'); await grant(evaluator,sco,'cash_exposure.read');
    internal=new InternalDatabaseService(); runtime=new RuntimeDatabaseService();
  });
  afterAll(async()=>{await internal?.onModuleDestroy(); await runtime?.onModuleDestroy(); await owner.end();});

  it('supports staged requirements, unverified versus verified totals, and current-step FUNDED semantics', async()=>{
    const c=await commitment(); const advance=await createRequirement(c,'ADVANCE',60000); await createRequirement(c,'BALANCE',60000);
    const receipt=await record(partner,partnerActor,advance,60000); const before=await runtime.getPaymentSummary(partnerActor,partner,c); if (!before) throw new Error('payment summary missing'); expect(Number(before.totalRequired)).toBe(120000); expect(Number(before.verifiedAmountReceived)).toBe(0); expect(Number(before.unverifiedAmountRecorded)).toBe(60000); expect(Number(before.amountRemaining)).toBe(120000);
    await internal.verifyPayment(paymentVerifier,receipt,'INTERNAL_CONFIRMATION','bank confirmation REF',id()); const after=await runtime.getPaymentSummary(partnerActor,partner,c); if (!after) throw new Error('payment summary missing'); expect(Number(after.verifiedAmountReceived)).toBe(60000); expect(Number(after.unverifiedAmountRecorded)).toBe(0); expect(Number(after.amountRemaining)).toBe(60000);
    const funding=await internal.createSupplierFundingRequirement(fundingManager,c,{stage:'CURRENT_PROCUREMENT_STEP',amount:60000,currency:'SAR',correlationId:id()}); const evaluation=await internal.evaluateFunding(evaluator,funding,id()); expect(evaluation.status).toBe('FUNDED'); expect(Number(evaluation.funding_gap)).toBe(0);
  });

  it('enforces tenant authorization, supplier separation, and no existence oracle', async()=>{
    const c=await commitment(); const req=await createRequirement(c,'ADVANCE',40000);
    await expect(record(otherPartner,otherActor,req,40000)).rejects.toThrow('PAYMENT_RECORD_NOT_AVAILABLE'); await expect(record(supplier,supplierActor,req,40000)).rejects.toThrow('PAYMENT_RECORD_NOT_AVAILABLE'); await expect(record(partner,dualActor,req,40000)).rejects.toThrow('PAYMENT_RECORD_NOT_AVAILABLE');
    expect(await runtime.getPaymentSummary(otherActor,otherPartner,c)).toBeNull(); expect(await runtime.getPaymentSummary(partnerActor,partner,id())).toBeNull();
    await expect(internal.createPaymentRequirement(unauthorized,c,{type:'BLOCKED',amount:1,currency:'SAR'})).rejects.toThrow('PAYMENT_REQUIREMENT_CREATE_FORBIDDEN');
  });

  it('supports document evidence and internal confirmation, with verifier separation and exactly-once verification', async()=>{
    const c=await commitment(); const req=await createRequirement(c,'MILESTONE',50000); const receipt=await record(partner,partnerActor,req,50000,'SAR',{evidenceReference:'private-doc-ref'});
    await expect(internal.verifyPayment(partnerActor,receipt,'DOCUMENT_EVIDENCE','self attempt',id())).rejects.toThrow('PAYMENT_VERIFY_FORBIDDEN');
    await expect(internal.verifyPayment(paymentVerifier,receipt,'DOCUMENT_EVIDENCE','',id())).rejects.toThrow('PAYMENT_VERIFICATION_REASON_REQUIRED');
    await internal.verifyPayment(paymentVerifier,receipt,'DOCUMENT_EVIDENCE','evidence reviewed',id()); await expect(internal.verifyPayment(paymentVerifier,receipt,'DOCUMENT_EVIDENCE','again',id())).rejects.toThrow('PAYMENT_NOT_VERIFIABLE');
    const second=await record(partner,partnerActor,req,10000); await expect(internal.verifyPayment(paymentVerifier,second,'INTERNAL_CONFIRMATION','',id())).rejects.toThrow('PAYMENT_VERIFICATION_REASON_REQUIRED'); await internal.verifyPayment(paymentVerifier,second,'INTERNAL_CONFIRMATION','internal confirmation REF-2',id());
    expect((await owner.query("SELECT count(*)::int AS count FROM audit_logs WHERE action='payment.verified' AND entity_id IN($1,$2)",[receipt,second])).rows[0].count).toBe(2);
  });

  it('calculates NOT_FUNDED and then FUNDED with explicit internal funding, never as Partner payment', async()=>{
    const c=await commitment(); const req=await createRequirement(c,'ADVANCE',120000); const receipt=await record(partner,partnerActor,req,40000); await internal.verifyPayment(paymentVerifier,receipt,'INTERNAL_CONFIRMATION','confirmed 40k',id());
    const funding=await internal.createSupplierFundingRequirement(fundingManager,c,{stage:'CURRENT_STEP',amount:70000,currency:'SAR',correlationId:id()}); const notFunded=await internal.evaluateFunding(evaluator,funding,id()); expect(notFunded.status).toBe('NOT_FUNDED'); expect(Number(notFunded.funding_gap)).toBe(30000);
    await internal.authorizeInternalFunding(fundingManager,funding,{amount:30000,currency:'SAR',reason:'approved current-step funding',correlationId:id()}); const funded=await internal.evaluateFunding(evaluator,funding,id()); expect(funded.status).toBe('FUNDED'); const summary=await runtime.getPaymentSummary(partnerActor,partner,c); if (!summary) throw new Error('payment summary missing'); expect(Number(summary.verifiedAmountReceived)).toBe(40000); expect((await owner.query('SELECT count(*)::int AS count FROM customer_payment_receipts WHERE commercial_commitment_id=$1',[c])).rows[0].count).toBe(1);
  });

  it('rejects unlike currencies without automatic FX and protects internal funding data', async()=>{
    const c=await commitment(); const req=await createRequirement(c,'ADVANCE',40000,'SAR'); const receipt=await record(partner,partnerActor,req,40000,'EUR'); await internal.verifyPayment(paymentVerifier,receipt,'INTERNAL_CONFIRMATION','EUR confirmation',id()); const funding=await internal.createSupplierFundingRequirement(fundingManager,c,{stage:'CURRENT_STEP',amount:70000,currency:'SAR',correlationId:id()}); const evaluation=await internal.evaluateFunding(evaluator,funding,id()); expect(evaluation.status).toBe('NOT_COMPARABLE'); expect(await internal.getSupplierFunding(partnerActor,funding)).toBeNull(); expect(await runtime.getPaymentSummary(partnerActor,partner,c)).not.toHaveProperty('fundingGap');
  });

  it('enforces immutable financial history, idempotency, RLS, and public/gateway boundaries', async()=>{
    const c=await commitment(); const req=await createRequirement(c,'ADVANCE',60000); const key=`IDEMP-${id()}`; const receipt=await runtime.recordPaymentReceipt(partnerActor,partner,{requirementId:req,amount:60000,currency:'SAR',paymentDate:'2026-09-24',idempotencyKey:key,correlationId:id()}); await expect(runtime.recordPaymentReceipt(partnerActor,partner,{requirementId:req,amount:60000,currency:'SAR',paymentDate:'2026-09-24',idempotencyKey:key,correlationId:id()})).rejects.toThrow('PAYMENT_RECEIPT_ALREADY_EXISTS');
    await expect(owner.query('UPDATE customer_payment_receipts SET amount=1 WHERE id=$1',[receipt])).rejects.toThrow('PAYMENT_FUNDING_HISTORY_IMMUTABLE');
    for(const table of ['customer_payment_requirements','customer_payment_receipts','customer_payment_verifications','supplier_funding_requirements','internal_funding_authorizations','cash_funding_evaluations']) { const row=(await owner.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[table])).rows[0]; expect(row).toMatchObject({relrowsecurity:true,relforcerowsecurity:true}); }
    const runtimeClient=new Client({connectionString:process.env.RUNTIME_DATABASE_URL}); await runtimeClient.connect(); try { await expect(runtimeClient.query('UPDATE customer_payment_receipts SET amount=1 WHERE false')).rejects.toThrow(/permission denied/i); } finally { await runtimeClient.end(); }
    const executor=new Client({connectionString:process.env.SCO_INTERNAL_DATABASE_URL}); await executor.connect(); try { await executor.query("SELECT set_config('app.payment_funding_gateway','true',true),set_config('app.sco_internal','true',true)"); await expect(executor.query('UPDATE cash_funding_evaluations SET funding_gap=0 WHERE false')).rejects.toThrow(/permission denied/i); } finally { await executor.end(); }
  });
});
