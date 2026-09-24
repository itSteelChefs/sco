import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService; let actor: string; let commitment: string; let line: string; let product: string; let unit: string; let snapshot: string; let receipt: string;

async function grant(code: string) {
  const company = (await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0]?.id ?? id();
  if (!(await owner.query('SELECT 1 FROM "Company" WHERE id=$1',[company])).rowCount) await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,'Batch95 SCO','SCO')`,[company]);
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x') ON CONFLICT (id) DO NOTHING`,[actor,`${actor}@batch95.test`]);
  const membership=(await owner.query(`SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2`,[actor,company])).rows[0]?.id ?? id();
  if (!(await owner.query(`SELECT 1 FROM "CompanyMembership" WHERE id=$1`,[membership])).rowCount) await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`,[membership,actor,company]);
  const role=id();
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`,[role,company,`batch95-${id()}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`,[id(),company,membership,role]);
  await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`,[id(),company,role,code]);
  return company;
}

async function fixture(amount = 100) {
  const sco = await grant('procurement_release.execute');
  const partner=id(); const supplier=id(); const creator=id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`,[creator,`${creator}@batch95.test`]);
  await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,'Batch95 Partner','PARTNER'),($2,'Batch95 Supplier','SUPPLIER')`,[partner,supplier]);
  const category=id(); unit=id(); product=id();
  await owner.query(`INSERT INTO product_categories(id,code,name) VALUES($1,$2,'Batch95')`,[category,`batch95-${category}`]);
  await owner.query(`INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,'Each','count')`,[unit,`batch95-${unit}`]);
  await owner.query(`INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,'ACTIVE')`,[product,category,unit,creator]);
  const project=id(); const need=id(); const cycle=id(); const execution=id(); const executionItem=id(); const rfq=id(); const rfqItem=id();
  await owner.query(`INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,'Batch95','ACTIVE',$4)`,[project,partner,`P-${project}`,creator]);
  await owner.query(`INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,'MANUAL',$5,'Batch95',$6,$7,current_date,'READY','APPROVED')`,[need,partner,project,creator,product,amount,unit]);
  await owner.query(`INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,'Batch95',now(),now(),'PROCESSING')`,[cycle,`C-${cycle}`]);
  await owner.query(`INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,'SOURCING_READY',$3)`,[execution,cycle,creator]);
  await owner.query(`INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,'SOURCING_READY')`,[executionItem,execution,partner,project,need,product,amount,unit,new Date(),id(),creator]);
  await owner.query(`INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,'EVALUATION')`,[rfq,creator]);
  await owner.query(`INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[rfqItem,rfq,executionItem,partner,project,need,product,amount,unit]);
  const partnership=id(); const source=id(); const quote=id(); const revision=id(); snapshot=id();
  await owner.query(`INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,'SUPPLIER_PARTNERSHIP','ACTIVE')`,[partnership,supplier]);
  const sourceType=(await owner.query(`SELECT id FROM purchase_source_type_definitions LIMIT 1`)).rows[0].id;
  await owner.query(`INSERT INTO supplier_qualifications(id,company_id,supplier_partnership_id,status,created_by) VALUES($1,$2,$3,'ACTIVE',$4)`,[id(),supplier,partnership,creator]);
  await owner.query(`INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,status,created_by) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)`,[source,supplier,partnership,`S-${source}`,sourceType,creator]);
  await owner.query(`INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)`,[quote,rfq,source,supplier,creator]);
  await owner.query(`INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code,valid_until) VALUES($1,$2,1,$3,'SAR','2099-12-31')`,[revision,quote,creator]);
  await owner.query(`INSERT INTO approved_purchase_cost_snapshots(id,rfq_item_id,supplier_quote_revision_id,purchase_source_id,supplier_company_id,product_identity_id,approved_quantity,currency_code,unit_purchase_cost,amount_excl_tax,amount_incl_tax,status,approved_by,approved_at,approval_reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'SAR',1,$7,$7,'APPROVED',$8,now(),'fixture',$8)`,[snapshot,rfqItem,revision,source,supplier,product,amount,actor]);
  const offer=id(); const offerRevision=id(); const po=id(); commitment=id(); line=id();
  await owner.query(`INSERT INTO partner_offers(id,company_id,offer_reference,created_by) VALUES($1,$2,$3,$4)`,[offer,partner,`O-${offer}`,creator]);
  await owner.query(`INSERT INTO partner_offer_revisions(id,partner_offer_id,revision_number,status,currency_code,offer_total_excl_tax,offer_tax_amount,offer_total_incl_tax,created_by) VALUES($1,$2,1,'ACCEPTED','SAR',$3,0,$3,$4)`,[offerRevision,offer,amount,creator]);
  await owner.query(`INSERT INTO partner_purchase_orders(id,partner_company_id,accepted_offer_id,accepted_offer_revision_id,po_reference,po_date,submitted_by,currency_code,total_excl_tax,total_incl_tax,status) VALUES($1,$2,$3,$4,$5,current_date,$6,'SAR',$7,$7,'VERIFIED')`,[po,partner,offer,offerRevision,`PO-${po}`,creator,amount]);
  await owner.query(`INSERT INTO commercial_commitments(id,partner_company_id,partner_purchase_order_id,accepted_offer_id,accepted_offer_revision_id,commitment_revision_number,currency_code,total_excl_tax,total_incl_tax,committed_by) VALUES($1,$2,$3,$4,$5,1,'SAR',$6,$6,$7)`,[commitment,partner,po,offer,offerRevision,amount,creator]);
  await owner.query(`INSERT INTO commercial_commitment_lines(id,commercial_commitment_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,amount_excl_tax,amount_incl_tax) VALUES($1,$2,1,$3,'Batch95',$4,$5,1,$4,$4)`,[line,commitment,product,amount,unit]);
  const req=id(); const paymentReq=id();
  await owner.query(`INSERT INTO customer_payment_requirements(id,commercial_commitment_id,partner_company_id,requirement_type,amount_required,currency_code,created_by) VALUES($1,$2,$3,'CURRENT',$4,'SAR',$5)`,[paymentReq,commitment,partner,amount,creator]);
  receipt=id(); await owner.query(`INSERT INTO customer_payment_receipts(id,customer_payment_requirement_id,commercial_commitment_id,partner_company_id,amount,currency_code,payment_date,status,recorded_by) VALUES($1,$2,$3,$4,$5,'SAR',current_date,'VERIFIED',$6)`,[receipt,paymentReq,commitment,partner,amount,creator]);
  await owner.query(`INSERT INTO supplier_funding_requirements(id,commercial_commitment_id,stage_type,amount_required,currency_code,status,created_by) VALUES($1,$2,'CURRENT_PROCUREMENT_STEP',$3,'SAR','FUNDED',$4)`,[req,commitment,amount,creator]);
  await owner.query(`INSERT INTO cash_funding_evaluations(id,supplier_funding_requirement_id,evaluation_number,currency_code,customer_verified_amount,supplier_funding_required,funding_gap,status,evaluated_by) VALUES($1,$2,1,'SAR',$3,$3,0,'FUNDED',$4)`,[id(),req,amount,creator]);
}

describe('Batch 9.5 customer funding reuse', () => {
  beforeAll(async () => { actor=id(); internal=new InternalDatabaseService(); await fixture(); await grant('procurement_release.withdraw'); });
  afterAll(async () => { await internal?.onModuleDestroy(); await owner.end(); });
  it('releases, withdraws, deallocates, and reuses the same verified customer source', async () => {
    const input=[{commercialCommitmentLineId:line,productIdentityId:product,quantity:60,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}];
    const releaseA=await internal.executeProcurementRelease(actor,commitment,input,id());
    expect((await owner.query(`SELECT status FROM procurement_releases WHERE id=$1`,[releaseA])).rows[0].status).toBe('PROCUREMENT_RELEASED');
    await internal.withdrawProcurementRelease(actor,releaseA,'withdraw for reuse',id());
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_funding_deallocations d JOIN procurement_funding_allocations a ON a.id=d.allocation_id WHERE a.release_id=$1`,[releaseA])).rows[0].count).toBe(1);
    const releaseB=await internal.executeProcurementRelease(actor,commitment,input,id());
    expect(releaseB).not.toBe(releaseA);
    const rows=(await owner.query(`SELECT count(*)::int AS allocations, count(*) FILTER (WHERE allocation_type='CUSTOMER_VERIFIED')::int AS customer FROM procurement_funding_allocations WHERE customer_payment_receipt_id=$1`,[receipt])).rows[0];
    expect(Number(rows.allocations)).toBe(2); expect(Number(rows.customer)).toBe(2);
    await internal.withdrawProcurementRelease(actor,releaseB,'reset fixture for next scenario',id());
  });

  it('rejects one of two genuinely concurrent 70/70 customer releases', async () => {
    const input=(qty:number)=>[{commercialCommitmentLineId:line,productIdentityId:product,quantity:qty,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}];
    const results=await Promise.allSettled([internal.executeProcurementRelease(actor,commitment,input(70),id()),internal.executeProcurementRelease(actor,commitment,input(70),id())]);
    expect(results.filter((r)=>r.status==='fulfilled')).toHaveLength(1);
    const active=Number((await owner.query(`SELECT COALESCE(sum(l.released_quantity),0) AS amount FROM procurement_release_lines l JOIN procurement_releases r ON r.id=l.release_id WHERE r.commercial_commitment_id=$1 AND r.status='PROCUREMENT_RELEASED'`,[commitment])).rows[0].amount);
    expect(active).toBe(70);
    const successful=results.find((r)=>r.status==='fulfilled') as PromiseFulfilledResult<string>;
    await internal.withdrawProcurementRelease(actor,successful.value,'reset concurrent fixture',id());
  });

  it('allows genuinely concurrent 30/40 customer releases within the source balance', async () => {
    const input=(qty:number)=>[{commercialCommitmentLineId:line,productIdentityId:product,quantity:qty,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}];
    const results=await Promise.allSettled([internal.executeProcurementRelease(actor,commitment,input(30),id()),internal.executeProcurementRelease(actor,commitment,input(40),id())]);
    expect(results.filter((r)=>r.status==='fulfilled')).toHaveLength(2);
    const active=Number((await owner.query(`SELECT COALESCE(sum(l.released_quantity),0) AS amount FROM procurement_release_lines l JOIN procurement_releases r ON r.id=l.release_id WHERE r.commercial_commitment_id=$1 AND r.status='PROCUREMENT_RELEASED'`,[commitment])).rows[0].amount);
    expect(active).toBe(70);
    for(const result of results as PromiseFulfilledResult<string>[]) await internal.withdrawProcurementRelease(actor,result.value,'reset partial concurrent fixture',id());
  });

  it('does not deallocate the same release twice', async () => {
    const release=await internal.executeProcurementRelease(actor,commitment,[{commercialCommitmentLineId:line,productIdentityId:product,quantity:60,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}],id());
    await internal.withdrawProcurementRelease(actor,release,'single deallocation',id());
    await expect(internal.withdrawProcurementRelease(actor,release,'duplicate deallocation',id())).rejects.toThrow('PROCUREMENT_RELEASE_NOT_WITHDRAWABLE');
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_funding_deallocations d JOIN procurement_funding_allocations a ON a.id=d.allocation_id WHERE a.release_id=$1`,[release])).rows[0].count).toBe(1);
  });

  it('allocates one release across two approved internal funding authorizations', async () => {
    const fixtureClient=await owner.connect();
    try { await fixtureClient.query('BEGIN'); await fixtureClient.query("SELECT set_config('app.payment_funding_gateway','true',true)"); await fixtureClient.query("UPDATE customer_payment_receipts SET status='RECORDED' WHERE id=$1", [receipt]); await fixtureClient.query('COMMIT'); } finally { fixtureClient.release(); }
    const requirement=(await owner.query(`SELECT id FROM supplier_funding_requirements WHERE commercial_commitment_id=$1`,[commitment])).rows[0].id;
    const a=id(); const b=id(); const c=id();
    await owner.query(`INSERT INTO internal_funding_authorizations(id,supplier_funding_requirement_id,amount_approved,currency_code,reason,approved_by) VALUES($1,$4,60,'SAR','fixture A',$2),($3,$4,40,'SAR','fixture B',$2),($5,$4,10,'SAR','fixture C',$2)`,[a,actor,b,requirement,c]);
    const release=await internal.executeProcurementRelease(actor,commitment,[{commercialCommitmentLineId:line,productIdentityId:product,quantity:100,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}],id());
    const rows=(await owner.query(`SELECT internal_funding_authorization_id,amount FROM procurement_funding_allocations WHERE release_id=$1 ORDER BY internal_funding_authorization_id`,[release])).rows;
    expect(rows.length).toBeGreaterThanOrEqual(2); expect(rows.reduce((sum,r)=>sum+Number(r.amount),0)).toBe(100); expect(rows.every((r)=>[a,b,c].includes(r.internal_funding_authorization_id))).toBe(true);
    expect(rows.every((r)=>Number(r.amount)>0)).toBe(true);
    expect(Number((await owner.query(`SELECT count(*)::int AS count FROM internal_funding_authorizations WHERE supplier_funding_requirement_id=$1`,[requirement])).rows[0].count)).toBe(3);
    await internal.withdrawProcurementRelease(actor,release,'reset fixture',id());
  });

  it('fails atomically when aggregate internal funding is insufficient', async () => {
    const creator=(await owner.query(`SELECT committed_by AS id FROM commercial_commitments WHERE id=$1`,[commitment])).rows[0].id;
    const partner=(await owner.query(`SELECT partner_company_id FROM commercial_commitments WHERE id=$1`,[commitment])).rows[0].partner_company_id;
    const offer=id(); const offerRevision=id(); const po=id(); const isolatedCommitment=id(); const isolatedLine=id();
    await owner.query(`INSERT INTO partner_offers(id,company_id,offer_reference,created_by) VALUES($1,$2,$3,$4)`,[offer,partner,`INS-${offer}`,creator]);
    await owner.query(`INSERT INTO partner_offer_revisions(id,partner_offer_id,revision_number,status,currency_code,offer_total_excl_tax,offer_tax_amount,offer_total_incl_tax,created_by) VALUES($1,$2,1,'ACCEPTED','SAR',100,0,100,$3)`,[offerRevision,offer,creator]);
    await owner.query(`INSERT INTO partner_purchase_orders(id,partner_company_id,accepted_offer_id,accepted_offer_revision_id,po_reference,po_date,submitted_by,currency_code,total_excl_tax,total_incl_tax,status) VALUES($1,$2,$3,$4,$5,current_date,$6,'SAR',100,100,'VERIFIED')`,[po,partner,offer,offerRevision,`INS-${po}`,creator]);
    await owner.query(`INSERT INTO commercial_commitments(id,partner_company_id,partner_purchase_order_id,accepted_offer_id,accepted_offer_revision_id,commitment_revision_number,currency_code,total_excl_tax,total_incl_tax,committed_by) VALUES($1,$2,$3,$4,$5,1,'SAR',100,100,$6)`,[isolatedCommitment,partner,po,offer,offerRevision,creator]);
    await owner.query(`INSERT INTO commercial_commitment_lines(id,commercial_commitment_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,amount_excl_tax,amount_incl_tax) VALUES($1,$2,1,$3,'insufficient',100,$4,1,100,100)`,[isolatedLine,isolatedCommitment,product,unit]);
    const requirement=id(); const authA=id(); const authB=id();
    await owner.query(`INSERT INTO supplier_funding_requirements(id,commercial_commitment_id,stage_type,amount_required,currency_code,status,created_by) VALUES($1,$2,'CURRENT_PROCUREMENT_STEP',100,'SAR','FUNDED',$3)`,[requirement,isolatedCommitment,creator]);
    await owner.query(`INSERT INTO internal_funding_authorizations(id,supplier_funding_requirement_id,amount_approved,currency_code,reason,approved_by) VALUES($1,$3,50,'SAR','A',$2),($4,$3,30,'SAR','B',$2)`,[authA,creator,requirement,authB]);
    await owner.query(`INSERT INTO cash_funding_evaluations(id,supplier_funding_requirement_id,evaluation_number,currency_code,customer_verified_amount,supplier_funding_required,approved_internal_funding,funding_gap,status,evaluated_by) VALUES($1,$2,1,'SAR',0,100,80,20,'FUNDED',$3)`,[id(),requirement,creator]);
    const before=(await owner.query(`SELECT count(*)::int AS count FROM procurement_releases`)).rows[0].count;
    await expect(internal.executeProcurementRelease(actor,isolatedCommitment,[{commercialCommitmentLineId:isolatedLine,productIdentityId:product,quantity:100,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}],id())).rejects.toThrow('PROCUREMENT_FUNDING_NOT_AVAILABLE');
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_releases`)).rows[0].count).toBe(before);
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_funding_allocations a JOIN procurement_releases r ON r.id=a.release_id WHERE r.commercial_commitment_id=$1`,[isolatedCommitment])).rows[0].count).toBe(0);
    expect((await owner.query(`SELECT amount_approved FROM internal_funding_authorizations WHERE id IN($1,$2) ORDER BY amount_approved`,[authA,authB])).rows.map((r)=>Number(r.amount_approved))).toEqual([30,50]);
  });

  it('separates mixed customer and multiple internal funding sources', async () => {
    await fixture(150);
    const client=await owner.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.payment_funding_gateway','true',true)"); await client.query('UPDATE customer_payment_receipts SET amount=80 WHERE id=$1',[receipt]); await client.query('COMMIT'); } finally { client.release(); }
    const requirement=(await owner.query(`SELECT id FROM supplier_funding_requirements WHERE commercial_commitment_id=$1`,[commitment])).rows[0].id; const a=id(); const b=id();
    await owner.query(`INSERT INTO internal_funding_authorizations(id,supplier_funding_requirement_id,amount_approved,currency_code,reason,approved_by) VALUES($1,$3,40,'SAR','A',$2),($4,$3,30,'SAR','B',$2)`,[a,actor,requirement,b]);
    const release=await internal.executeProcurementRelease(actor,commitment,[{commercialCommitmentLineId:line,productIdentityId:product,quantity:150,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}],id());
    const allocations=(await owner.query(`SELECT allocation_type,customer_payment_receipt_id,internal_funding_authorization_id,amount FROM procurement_funding_allocations WHERE release_id=$1`,[release])).rows;
    expect(allocations.reduce((sum,row)=>sum+Number(row.amount),0)).toBe(150);
    const customerAllocation=allocations.find((row)=>row.allocation_type==='CUSTOMER_VERIFIED');
    expect(customerAllocation).toMatchObject({customer_payment_receipt_id:receipt,internal_funding_authorization_id:null});
    expect(Number(customerAllocation.amount)).toBe(80);
    expect(allocations.filter((row)=>row.allocation_type==='SCO_INTERNAL').map((row)=>Number(row.amount)).sort((x,y)=>x-y)).toEqual([30,40]);
    expect(allocations.filter((row)=>row.allocation_type==='SCO_INTERNAL').every((row)=>row.customer_payment_receipt_id===null && [a,b].includes(row.internal_funding_authorization_id))).toBe(true);
  });

  it('partially consumes one internal authorization across two releases', async () => {
    await fixture();
    const client=await owner.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.payment_funding_gateway','true',true)"); await client.query("UPDATE customer_payment_receipts SET status='RECORDED' WHERE id=$1",[receipt]); await client.query('COMMIT'); } finally { client.release(); }
    const requirement=(await owner.query(`SELECT id FROM supplier_funding_requirements WHERE commercial_commitment_id=$1`,[commitment])).rows[0].id; const authorization=id();
    await owner.query(`INSERT INTO internal_funding_authorizations(id,supplier_funding_requirement_id,amount_approved,currency_code,reason,approved_by) VALUES($1,$2,100,'SAR','partial',$3)`,[authorization,requirement,actor]);
    const run=(quantity:number)=>internal.executeProcurementRelease(actor,commitment,[{commercialCommitmentLineId:line,productIdentityId:product,quantity,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}],id());
    await run(30); await run(40);
    const active=Number((await owner.query(`SELECT COALESCE(sum(a.amount),0)-COALESCE(sum(d.amount),0) AS amount FROM procurement_funding_allocations a LEFT JOIN procurement_funding_deallocations d ON d.allocation_id=a.id WHERE a.internal_funding_authorization_id=$1`,[authorization])).rows[0].amount);
    expect(active).toBe(70);
    const secondLine=id();
    await owner.query(`INSERT INTO commercial_commitment_lines(id,commercial_commitment_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,amount_excl_tax,amount_incl_tax) VALUES($1,$2,2,$3,'second',100,$4,1,100,100)`,[secondLine,commitment,product,unit]);
    await expect(internal.executeProcurementRelease(actor,commitment,[{commercialCommitmentLineId:secondLine,productIdentityId:product,quantity:31,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}],id())).rejects.toThrow('PROCUREMENT_FUNDING_NOT_AVAILABLE');
  });

  it('withdraws and reuses an internal funding allocation without rewriting history', async () => {
    await fixture();
    const client=await owner.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.payment_funding_gateway','true',true)"); await client.query("UPDATE customer_payment_receipts SET status='RECORDED' WHERE id=$1",[receipt]); await client.query('COMMIT'); } finally { client.release(); }
    const requirement=(await owner.query(`SELECT id FROM supplier_funding_requirements WHERE commercial_commitment_id=$1`,[commitment])).rows[0].id; const authorization=id();
    await owner.query(`INSERT INTO internal_funding_authorizations(id,supplier_funding_requirement_id,amount_approved,currency_code,reason,approved_by) VALUES($1,$2,100,'SAR','reuse',$3)`,[authorization,requirement,actor]);
    const input=[{commercialCommitmentLineId:line,productIdentityId:product,quantity:60,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}];
    const first=await internal.executeProcurementRelease(actor,commitment,input,id()); await internal.withdrawProcurementRelease(actor,first,'release internal funds',id());
    const second=await internal.executeProcurementRelease(actor,commitment,input,id());
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_funding_allocations WHERE internal_funding_authorization_id=$1`,[authorization])).rows[0].count).toBe(2);
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_funding_deallocations d JOIN procurement_funding_allocations a ON a.id=d.allocation_id WHERE a.release_id=$1`,[first])).rows[0].count).toBe(1);
    expect(second).not.toBe(first);
  });

  it('rejects one of two concurrent internal multi-source releases', async () => {
    await fixture();
    const client=await owner.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.payment_funding_gateway','true',true)"); await client.query("UPDATE customer_payment_receipts SET status='RECORDED' WHERE id=$1",[receipt]); await client.query('COMMIT'); } finally { client.release(); }
    const requirement=(await owner.query(`SELECT id FROM supplier_funding_requirements WHERE commercial_commitment_id=$1`,[commitment])).rows[0].id; const a=id(); const b=id();
    await owner.query(`INSERT INTO internal_funding_authorizations(id,supplier_funding_requirement_id,amount_approved,currency_code,reason,approved_by) VALUES($1,$3,60,'SAR','A',$2),($4,$3,40,'SAR','B',$2)`,[a,actor,requirement,b]);
    const input=[{commercialCommitmentLineId:line,productIdentityId:product,quantity:70,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}];
    const results=await Promise.allSettled([internal.executeProcurementRelease(actor,commitment,input,id()),internal.executeProcurementRelease(actor,commitment,input,id())]);
    expect(results.filter((r)=>r.status==='fulfilled')).toHaveLength(1);
    const active=Number((await owner.query(`SELECT COALESCE(sum(a.amount),0)-COALESCE(sum(d.amount),0) AS amount FROM procurement_funding_allocations a LEFT JOIN procurement_funding_deallocations d ON d.allocation_id=a.id WHERE a.internal_funding_authorization_id IN($1,$2)`,[a,b])).rows[0].amount);
    expect(active).toBeLessThanOrEqual(100);
  });

  it('prevents concurrent double-spend after a withdrawn customer-funded release', async () => {
    await fixture();
    const input=(quantity:number)=>[{commercialCommitmentLineId:line,productIdentityId:product,quantity,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}];
    const original=await internal.executeProcurementRelease(actor,commitment,input(100),id());
    await internal.withdrawProcurementRelease(actor,original,'restore source before concurrent reuse',id());
    const results=await Promise.allSettled([internal.executeProcurementRelease(actor,commitment,input(70),id()),internal.executeProcurementRelease(actor,commitment,input(70),id())]);
    expect(results.filter((result)=>result.status==='fulfilled')).toHaveLength(1);
    const active=Number((await owner.query(`SELECT COALESCE(sum(a.amount),0)-COALESCE(sum(d.amount),0) AS amount FROM procurement_funding_allocations a LEFT JOIN procurement_funding_deallocations d ON d.allocation_id=a.id WHERE a.customer_payment_receipt_id=$1`,[receipt])).rows[0].amount);
    expect(active).toBe(70);
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_funding_deallocations d JOIN procurement_funding_allocations a ON a.id=d.allocation_id WHERE a.release_id=$1`,[original])).rows[0].count).toBe(1);
  });

  it('prevents concurrent over-release by committed quantity while funding is sufficient', async () => {
    await fixture();
    const input=[{commercialCommitmentLineId:line,productIdentityId:product,quantity:70,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}];
    const results=await Promise.allSettled([internal.executeProcurementRelease(actor,commitment,input,id()),internal.executeProcurementRelease(actor,commitment,input,id())]);
    expect(results.filter((result)=>result.status==='fulfilled')).toHaveLength(1);
    expect(String((results.find((result)=>result.status==='rejected') as PromiseRejectedResult).reason)).toContain('PROCUREMENT_RELEASE_QUANTITY_EXCEEDED');
    const released=Number((await owner.query(`SELECT COALESCE(sum(l.released_quantity),0) AS quantity FROM procurement_release_lines l JOIN procurement_releases r ON r.id=l.release_id WHERE r.commercial_commitment_id=$1 AND r.status='PROCUREMENT_RELEASED'`,[commitment])).rows[0].quantity);
    expect(released).toBe(70);
  });

  it('rolls back a multi-line release when one selected line is invalid', async () => {
    await fixture();
    const validLine=id();
    await owner.query(`INSERT INTO commercial_commitment_lines(id,commercial_commitment_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,amount_excl_tax,amount_incl_tax) VALUES($1,$2,2,$3,'valid second line',20,$4,1,20,20)`,[validLine,commitment,product,unit]);
    const before=(await owner.query(`SELECT count(*)::int AS count FROM procurement_releases WHERE commercial_commitment_id=$1`,[commitment])).rows[0].count;
    await expect(internal.executeProcurementRelease(actor,commitment,[{commercialCommitmentLineId:line,productIdentityId:product,quantity:20,unitId:unit,approvedPurchaseCostSnapshotId:snapshot},{commercialCommitmentLineId:id(),productIdentityId:product,quantity:20,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}],id())).rejects.toThrow('PROCUREMENT_RELEASE_LINE_INVALID');
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_releases WHERE commercial_commitment_id=$1`,[commitment])).rows[0].count).toBe(before);
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_funding_allocations a JOIN procurement_releases r ON r.id=a.release_id WHERE r.commercial_commitment_id=$1`,[commitment])).rows[0].count).toBe(0);
  });

  it('creates a complete multi-line release atomically with source-bound allocations', async () => {
    await fixture();
    const secondLine=id();
    await owner.query(`INSERT INTO commercial_commitment_lines(id,commercial_commitment_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,amount_excl_tax,amount_incl_tax) VALUES($1,$2,2,$3,'second line',20,$4,1,20,20)`,[secondLine,commitment,product,unit]);
    const release=await internal.executeProcurementRelease(actor,commitment,[{commercialCommitmentLineId:line,productIdentityId:product,quantity:60,unitId:unit,approvedPurchaseCostSnapshotId:snapshot},{commercialCommitmentLineId:secondLine,productIdentityId:product,quantity:20,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}],id());
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_release_lines WHERE release_id=$1`,[release])).rows[0].count).toBe(2);
    expect(Number((await owner.query(`SELECT sum(released_quantity) AS quantity FROM procurement_release_lines WHERE release_id=$1`,[release])).rows[0].quantity)).toBe(80);
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_funding_allocations WHERE release_id=$1 AND customer_payment_receipt_id=$2`,[release,receipt])).rows[0].count).toBe(1);
    expect((await owner.query(`SELECT count(*)::int AS count FROM audit_logs WHERE entity_id=$1 AND action='procurement_release.executed'`,[release])).rows[0].count).toBe(1);
  });
});
