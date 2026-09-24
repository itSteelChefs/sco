import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let actor: string; let source: string; let product: string; let unit: string; let commitment: string; let releaseLine: string; let snapshot: string;

async function grant(code: string) {
  const sco = (await owner.query(`SELECT id FROM "Company" WHERE type='SCO' LIMIT 1`)).rows[0].id;
  let membership = (await owner.query(`SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2`, [actor, sco])).rows[0]?.id as string | undefined; const role = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x') ON CONFLICT(id) DO NOTHING`, [actor, `${actor}.${code}@supplier-po.test`]);
  if (!membership) { membership=id(); await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership, actor, sco]); }
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [role, sco, `supplier-po-${id()}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(), sco, membership, role]);
  await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [id(), sco, role, code]);
}

async function fixture() {
  actor=id();
  for (const code of ['procurement_release.execute','supplier_po.draft.create','supplier_po.issue']) await grant(code);
  const partner=id(); const supplier=id(); const creator=id(); const category=id(); unit=id(); product=id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`,[creator,`${creator}@supplier-po.test`]);
  await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,'PO Partner','PARTNER'),($2,'PO Supplier','SUPPLIER')`,[partner,supplier]);
  await owner.query(`INSERT INTO product_categories(id,code,name) VALUES($1,$2,'PO')`,[category,`po-${category}`]);
  await owner.query(`INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,'Each','count')`,[unit,`po-${unit}`]);
  await owner.query(`INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,'ACTIVE')`,[product,category,unit,creator]);
  const project=id(), need=id(), cycle=id(), execution=id(), executionItem=id(), rfq=id(), rfqItem=id();
  await owner.query(`INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,'PO','ACTIVE',$4)`,[project,partner,`P-${project}`,creator]);
  await owner.query(`INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,'MANUAL',$5,'PO',100,$6,current_date,'READY','APPROVED')`,[need,partner,project,creator,product,unit]);
  await owner.query(`INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,'PO',now(),now(),'PROCESSING')`,[cycle,`C-${cycle}`]);
  await owner.query(`INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,'SOURCING_READY',$3)`,[execution,cycle,creator]);
  await owner.query(`INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,100,100,$7,current_date,$8,$9,'SOURCING_READY')`,[executionItem,execution,partner,project,need,product,unit,id(),creator]);
  await owner.query(`INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,'EVALUATION')`,[rfq,creator]);
  await owner.query(`INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,100,$8)`,[rfqItem,rfq,executionItem,partner,project,need,product,unit]);
  const partnership=id(); source=id(); const sourceType=(await owner.query(`SELECT id FROM purchase_source_type_definitions LIMIT 1`)).rows[0].id;
  await owner.query(`INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,'SUPPLIER_PARTNERSHIP','ACTIVE')`,[partnership,supplier]);
  await owner.query(`INSERT INTO supplier_qualifications(id,company_id,supplier_partnership_id,status,created_by) VALUES($1,$2,$3,'ACTIVE',$4)`,[id(),supplier,partnership,creator]);
  await owner.query(`INSERT INTO supplier_category_capabilities(id,company_id,supplier_partnership_id,category_id,status) VALUES($1,$2,$3,$4,'ACTIVE')`,[id(),supplier,partnership,category]);
  await owner.query(`INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,status,created_by) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)`,[source,supplier,partnership,`S-${source}`,sourceType,creator]);
  const quote=id(), revision=id(); snapshot=id();
  await owner.query(`INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)`,[quote,rfq,source,supplier,creator]);
  await owner.query(`INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code,valid_until) VALUES($1,$2,1,$3,'SAR','2099-12-31')`,[revision,quote,creator]);
  await owner.query(`INSERT INTO approved_purchase_cost_snapshots(id,rfq_item_id,supplier_quote_revision_id,purchase_source_id,supplier_company_id,product_identity_id,approved_quantity,currency_code,unit_purchase_cost,amount_excl_tax,amount_incl_tax,status,approved_by,approved_at,approval_reason,created_by) VALUES($1,$2,$3,$4,$5,$6,100,'SAR',1,100,100,'APPROVED',$7,now(),'fixture',$7)`,[snapshot,rfqItem,revision,source,supplier,product,actor]);
  const offer=id(), offerRevision=id(), partnerPo=id(); commitment=id(); const line=id();
  await owner.query(`INSERT INTO partner_offers(id,company_id,offer_reference,created_by) VALUES($1,$2,$3,$4)`,[offer,partner,`O-${offer}`,creator]);
  await owner.query(`INSERT INTO partner_offer_revisions(id,partner_offer_id,revision_number,status,currency_code,offer_total_excl_tax,offer_tax_amount,offer_total_incl_tax,created_by) VALUES($1,$2,1,'ACCEPTED','SAR',100,0,100,$3)`,[offerRevision,offer,creator]);
  await owner.query(`INSERT INTO partner_purchase_orders(id,partner_company_id,accepted_offer_id,accepted_offer_revision_id,po_reference,po_date,submitted_by,currency_code,total_excl_tax,total_incl_tax,status) VALUES($1,$2,$3,$4,$5,current_date,$6,'SAR',100,100,'VERIFIED')`,[partnerPo,partner,offer,offerRevision,`P-${partnerPo}`,creator]);
  await owner.query(`INSERT INTO commercial_commitments(id,partner_company_id,partner_purchase_order_id,accepted_offer_id,accepted_offer_revision_id,commitment_revision_number,currency_code,total_excl_tax,total_incl_tax,committed_by) VALUES($1,$2,$3,$4,$5,1,'SAR',100,100,$6)`,[commitment,partner,partnerPo,offer,offerRevision,creator]);
  await owner.query(`INSERT INTO commercial_commitment_lines(id,commercial_commitment_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,amount_excl_tax,amount_incl_tax) VALUES($1,$2,1,$3,'PO',100,$4,1,100,100)`,[line,commitment,product,unit]);
  const paymentRequirement=id(), receipt=id(), requirement=id();
  await owner.query(`INSERT INTO customer_payment_requirements(id,commercial_commitment_id,partner_company_id,requirement_type,amount_required,currency_code,created_by) VALUES($1,$2,$3,'CURRENT',100,'SAR',$4)`,[paymentRequirement,commitment,partner,creator]);
  await owner.query(`INSERT INTO customer_payment_receipts(id,customer_payment_requirement_id,commercial_commitment_id,partner_company_id,amount,currency_code,payment_date,status,recorded_by) VALUES($1,$2,$3,$4,100,'SAR',current_date,'VERIFIED',$5)`,[receipt,paymentRequirement,commitment,partner,creator]);
  await owner.query(`INSERT INTO supplier_funding_requirements(id,commercial_commitment_id,stage_type,amount_required,currency_code,status,created_by) VALUES($1,$2,'CURRENT_PROCUREMENT_STEP',100,'SAR','FUNDED',$3)`,[requirement,commitment,creator]);
  await owner.query(`INSERT INTO cash_funding_evaluations(id,supplier_funding_requirement_id,evaluation_number,currency_code,customer_verified_amount,supplier_funding_required,funding_gap,status,evaluated_by) VALUES($1,$2,1,'SAR',100,100,0,'FUNDED',$3)`,[id(),requirement,creator]);
  const release = await internal.executeProcurementRelease(actor,commitment,[{commercialCommitmentLineId:line,productIdentityId:product,quantity:100,unitId:unit,approvedPurchaseCostSnapshotId:snapshot}],id());
  releaseLine=(await owner.query(`SELECT id FROM procurement_release_lines WHERE release_id=$1`,[release])).rows[0].id;
  await owner.query(`INSERT INTO supplier_po_financial_authorities(actor_user_id,max_issue_amount_sar,changed_by) VALUES($1,1000,$1)`,[actor]);
}

describe('Batch 9.6.1 supplier purchase order core', () => {
  beforeAll(async () => { internal = new InternalDatabaseService(); await fixture(); });
  afterAll(async () => { await internal.onModuleDestroy(); await owner.end(); });

  it('provides SCO-internal Supplier PO tables and an issuance gateway', async () => {
    const tables = await owner.query(`SELECT to_regclass('public.supplier_purchase_orders') AS purchase_order, to_regclass('public.supplier_purchase_order_lines') AS line, to_regclass('public.supplier_po_release_line_allocations') AS release_allocation, to_regclass('public.supplier_po_coverage_bindings') AS coverage_binding`);
    expect(tables.rows[0]).toEqual({ purchase_order: 'supplier_purchase_orders', line: 'supplier_purchase_order_lines', release_allocation: 'supplier_po_release_line_allocations', coverage_binding: 'supplier_po_coverage_bindings' });
    const gateway = await owner.query(`SELECT to_regprocedure('public.internal_supplier_po_issue(uuid,uuid,text)') AS issue_gateway`);
    expect(gateway.rows[0].issue_gateway).toBe('internal_supplier_po_issue(uuid,uuid,text)');
  });

  it('issues an SCO-internal PO and binds existing release coverage without rewriting the release', async () => {
    const po = await internal.createSupplierPurchaseOrderDraft(actor, source, 'SAR', [{
      productIdentityId: product, unitId: unit, quantity: 70, actualUnitPurchaseCost: 1,
      releaseAllocations: [{ releaseLineId: releaseLine, quantity: 70 }],
    }], undefined, id());
    await internal.issueSupplierPurchaseOrder(actor, po, id());
    const issued = (await owner.query(`SELECT status,total_actual_purchase_cost FROM supplier_purchase_orders WHERE id=$1`,[po])).rows[0];
    expect(issued).toMatchObject({ status: 'ISSUED', total_actual_purchase_cost: '70.000000' });
    expect((await owner.query(`SELECT sum(bound_amount) AS amount FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id WHERE l.supplier_purchase_order_id=$1`,[po])).rows[0].amount).toBe('70.000000');
    expect((await owner.query(`SELECT released_quantity FROM procurement_release_lines WHERE id=$1`,[releaseLine])).rows[0].released_quantity).toBe('100.0000');
    expect((await owner.query(`SELECT count(*)::int AS count FROM audit_logs WHERE entity_id=$1 AND action='supplier_po.issued'`,[po])).rows[0].count).toBe(1);
  });

  it('allows competing drafts without reserving release quantity or Purchase Coverage', async () => {
    await fixture();
    const line = { productIdentityId: product, unitId: unit, quantity: 100, actualUnitPurchaseCost: 1, releaseAllocations: [{ releaseLineId: releaseLine, quantity: 100 }] };
    await internal.createSupplierPurchaseOrderDraft(actor, source, 'SAR', [line], undefined, id());
    await internal.createSupplierPurchaseOrderDraft(actor, source, 'SAR', [line], undefined, id());
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id WHERE a.procurement_release_line_id=$1`,[releaseLine])).rows[0].count).toBe(0);
    expect((await owner.query(`SELECT COALESCE(sum(a.allocated_quantity),0) AS quantity FROM supplier_po_release_line_allocations a JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE a.procurement_release_line_id=$1 AND p.status='ISSUED'`,[releaseLine])).rows[0].quantity).toBe('0');
  });

  it('enforces the SAR financial authority and rejects non-SAR issuance safely', async () => {
    await fixture();
    await owner.query(`UPDATE supplier_po_financial_authorities SET max_issue_amount_sar=20 WHERE actor_user_id=$1`,[actor]);
    const po = await internal.createSupplierPurchaseOrderDraft(actor, source, 'SAR', [{ productIdentityId: product, unitId: unit, quantity: 30, actualUnitPurchaseCost: 1, releaseAllocations: [{ releaseLineId: releaseLine, quantity: 30 }] }], undefined, id());
    await expect(internal.issueSupplierPurchaseOrder(actor, po, id())).rejects.toThrow('SUPPLIER_PO_FINANCIAL_LIMIT_EXCEEDED');
    expect((await owner.query(`SELECT status FROM supplier_purchase_orders WHERE id=$1`,[po])).rows[0].status).toBe('DRAFT');
    const nonSar = await internal.createSupplierPurchaseOrderDraft(actor, source, 'USD', [{ productIdentityId: product, unitId: unit, quantity: 10, actualUnitPurchaseCost: 1, releaseAllocations: [{ releaseLineId: releaseLine, quantity: 10 }] }], undefined, id());
    await expect(internal.issueSupplierPurchaseOrder(actor, nonSar, id())).rejects.toThrow('SUPPLIER_PO_FINANCIAL_CURRENCY_UNSUPPORTED');
  });

  it('prevents over-purchasing an issued release line and leaves the remaining quantity derived', async () => {
    await fixture();
    const first = await internal.createSupplierPurchaseOrderDraft(actor, source, 'SAR', [{ productIdentityId: product, unitId: unit, quantity: 70, actualUnitPurchaseCost: 1, releaseAllocations: [{ releaseLineId: releaseLine, quantity: 70 }] }], undefined, id());
    await internal.issueSupplierPurchaseOrder(actor, first, id());
    const second = await internal.createSupplierPurchaseOrderDraft(actor, source, 'SAR', [{ productIdentityId: product, unitId: unit, quantity: 31, actualUnitPurchaseCost: 1, releaseAllocations: [{ releaseLineId: releaseLine, quantity: 31 }] }], undefined, id());
    await expect(internal.issueSupplierPurchaseOrder(actor, second, id())).rejects.toThrow('SUPPLIER_PO_RELEASE_QUANTITY_EXCEEDED');
    const open = await owner.query(`SELECT r.released_quantity-COALESCE(sum(a.allocated_quantity) FILTER (WHERE p.status='ISSUED'),0) AS quantity FROM procurement_release_lines r LEFT JOIN supplier_po_release_line_allocations a ON a.procurement_release_line_id=r.id LEFT JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id LEFT JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE r.id=$1 GROUP BY r.released_quantity`,[releaseLine]);
    expect(open.rows[0].quantity).toBe('30.0000');
  });

  it('aggregates two partner releases and two products into one SCO-internal PO without contributor columns', async () => {
    await fixture();
    const sourceA=source, productA=product, unitA=unit, releaseLineA=releaseLine;
    const supplierA=(await owner.query(`SELECT supplier_company_id, supplier_partnership_id FROM purchase_sources WHERE id=$1`,[sourceA])).rows[0];
    await fixture();
    const productB=product, unitB=unit, releaseLineB=releaseLine;
    const categoryB=(await owner.query(`SELECT category_id FROM product_identities WHERE id=$1`,[productB])).rows[0].category_id;
    await owner.query(`INSERT INTO supplier_category_capabilities(id,company_id,supplier_partnership_id,category_id,status) VALUES($1,$2,$3,$4,'ACTIVE')`,[id(),supplierA.supplier_company_id,supplierA.supplier_partnership_id,categoryB]);
    await grant('supplier_reconfirmation.create');
    const reconfirmation=await internal.createSupplierReconfirmation(actor,{ purchaseSourceId:sourceA, supplierCompanyId:supplierA.supplier_company_id, productIdentityId:productB, price:0.5, currency:'SAR', quantity:40, validUntil:'2099-12-31', correlationId:id() });
    const po=await internal.createSupplierPurchaseOrderDraft(actor,sourceA,'SAR',[
      { productIdentityId:productA,unitId:unitA,quantity:30,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLineA,quantity:30}] },
      { productIdentityId:productB,unitId:unitB,quantity:40,actualUnitPurchaseCost:0.5,supplierReconfirmationId:reconfirmation,releaseAllocations:[{releaseLineId:releaseLineB,quantity:40}] },
    ],undefined,id());
    await internal.issueSupplierPurchaseOrder(actor,po,id());
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_purchase_order_lines WHERE supplier_purchase_order_id=$1`,[po])).rows[0].count).toBe(2);
    expect((await owner.query(`SELECT count(DISTINCT r.partner_company_id)::int AS count FROM supplier_po_release_line_allocations a JOIN procurement_release_lines rl ON rl.id=a.procurement_release_line_id JOIN procurement_releases r ON r.id=rl.release_id JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id WHERE l.supplier_purchase_order_id=$1`,[po])).rows[0].count).toBe(2);
    const partnerColumns=(await owner.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('supplier_purchase_orders','supplier_purchase_order_lines') AND column_name ILIKE '%partner%'`)).rows;
    expect(partnerColumns).toEqual([]);
  });

  it('uses a qualified alternative source only with current lower-price reconfirmation and preserves original source history', async () => {
    await fixture();
    const originalSource=source; const sourceRow=(await owner.query(`SELECT supplier_company_id,supplier_partnership_id FROM purchase_sources WHERE id=$1`,[source])).rows[0];
    const alternative=id(); const sourceType=(await owner.query(`SELECT id FROM purchase_source_type_definitions LIMIT 1`)).rows[0].id;
    await owner.query(`INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,status,created_by) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)`,[alternative,sourceRow.supplier_company_id,sourceRow.supplier_partnership_id,`ALT-${alternative}`,sourceType,actor]);
    await grant('supplier_reconfirmation.create');
    const reconfirmation=await internal.createSupplierReconfirmation(actor,{ purchaseSourceId:alternative,supplierCompanyId:sourceRow.supplier_company_id,productIdentityId:product,price:0.8,currency:'SAR',quantity:50,validUntil:'2099-12-31',correlationId:id() });
    const po=await internal.createSupplierPurchaseOrderDraft(actor,alternative,'SAR',[{productIdentityId:product,unitId:unit,quantity:50,actualUnitPurchaseCost:0.8,supplierReconfirmationId:reconfirmation,releaseAllocations:[{releaseLineId:releaseLine,quantity:50}]}],undefined,id());
    await internal.issueSupplierPurchaseOrder(actor,po,id());
    const allocation=(await owner.query(`SELECT original_purchase_source_id,approved_unit_purchase_cost FROM supplier_po_release_line_allocations a JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id WHERE l.supplier_purchase_order_id=$1`,[po])).rows[0];
    expect(allocation).toMatchObject({original_purchase_source_id:originalSource,approved_unit_purchase_cost:'1.000000'});
    expect((await owner.query(`SELECT purchase_source_id,total_actual_purchase_cost FROM supplier_purchase_orders WHERE id=$1`,[po])).rows[0]).toMatchObject({purchase_source_id:alternative,total_actual_purchase_cost:'40.000000'});
  });

  it('does not allow Release withdrawal after an issued PO has bound its coverage', async () => {
    await fixture(); await grant('procurement_release.withdraw');
    const po=await internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[{productIdentityId:product,unitId:unit,quantity:50,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:50}]}],undefined,id());
    await internal.issueSupplierPurchaseOrder(actor,po,id());
    const release=(await owner.query(`SELECT release_id FROM procurement_release_lines WHERE id=$1`,[releaseLine])).rows[0].release_id;
    await expect(internal.withdrawProcurementRelease(actor,release,'must retain issued coverage',id())).rejects.toThrow('PROCUREMENT_RELEASE_ALREADY_PURCHASED');
  });

  it('requires explicit strategic authority to change a Preferred Purchase Source', async () => {
    await fixture();
    await expect(internal.setPurchaseSourcePreference(actor,source,true,'strategic relationship',id())).rejects.toThrow('PURCHASE_SOURCE_PREFERENCE_FORBIDDEN');
    await grant('purchase_source.preference.manage');
    await internal.setPurchaseSourcePreference(actor,source,true,'strategic relationship',id());
    expect((await owner.query(`SELECT is_preferred FROM purchase_source_preferences WHERE purchase_source_id=$1`,[source])).rows[0].is_preferred).toBe(true);
  });

  it('keeps authorized Strategic Overbuy isolated from Partner demand and Purchase Coverage', async () => {
    await fixture();
    await expect(internal.authorizeStrategicOverbuy(actor,{purchaseSourceId:source,productIdentityId:product,unitId:unit,quantity:10,currency:'SAR',maxUnitPurchaseCost:1,reason:'SCO stock strategy',correlationId:id()})).rejects.toThrow('STRATEGIC_OVERBUY_FORBIDDEN');
    await grant('strategic_overbuy.authorize');
    const authorization=await internal.authorizeStrategicOverbuy(actor,{purchaseSourceId:source,productIdentityId:product,unitId:unit,quantity:10,currency:'SAR',maxUnitPurchaseCost:1,reason:'SCO stock strategy',correlationId:id()});
    const po=await internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[{demandOrigin:'STRATEGIC_OVERBUY',strategicOverbuyAuthorizationId:authorization,productIdentityId:product,unitId:unit,quantity:10,actualUnitPurchaseCost:1}],undefined,id());
    await internal.issueSupplierPurchaseOrder(actor,po,id());
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_po_release_line_allocations a JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id WHERE l.supplier_purchase_order_id=$1`,[po])).rows[0].count).toBe(0);
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id WHERE l.supplier_purchase_order_id=$1`,[po])).rows[0].count).toBe(0);
  });

  it('counts only issued Strategic Overbuy quantities and rejects a later PO above the remaining authorization', async () => {
    await fixture(); await grant('strategic_overbuy.authorize');
    const authorization=await internal.authorizeStrategicOverbuy(actor,{purchaseSourceId:source,productIdentityId:product,unitId:unit,quantity:10,currency:'SAR',maxUnitPurchaseCost:1,reason:'limited strategy',correlationId:id()});
    const create=(quantity:number)=>internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[{demandOrigin:'STRATEGIC_OVERBUY',strategicOverbuyAuthorizationId:authorization,productIdentityId:product,unitId:unit,quantity,actualUnitPurchaseCost:1}],undefined,id());
    const issued=await create(7); await internal.issueSupplierPurchaseOrder(actor,issued,id());
    const later=await create(4);
    await expect(internal.issueSupplierPurchaseOrder(actor,later,id())).rejects.toThrow('STRATEGIC_OVERBUY_QUANTITY_EXCEEDED');
    expect((await owner.query(`SELECT COALESCE(sum(l.ordered_quantity),0) AS quantity FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE l.strategic_overbuy_authorization_id=$1 AND p.status='ISSUED'`,[authorization])).rows[0].quantity).toBe('7.0000');
  });

  it('permits two Strategic Overbuy drafts but prevents concurrent issuance above one authorization', async () => {
    await fixture(); await grant('strategic_overbuy.authorize');
    const authorization=await internal.authorizeStrategicOverbuy(actor,{purchaseSourceId:source,productIdentityId:product,unitId:unit,quantity:10,currency:'SAR',maxUnitPurchaseCost:1,reason:'concurrent strategy',correlationId:id()});
    const create=()=>internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[{demandOrigin:'STRATEGIC_OVERBUY',strategicOverbuyAuthorizationId:authorization,productIdentityId:product,unitId:unit,quantity:7,actualUnitPurchaseCost:1}],undefined,id());
    const [draftA,draftB]=await Promise.all([create(),create()]);
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_purchase_orders WHERE id IN($1,$2) AND status='DRAFT'`,[draftA,draftB])).rows[0].count).toBe(2);
    const results=await Promise.allSettled([internal.issueSupplierPurchaseOrder(actor,draftA,id()),internal.issueSupplierPurchaseOrder(actor,draftB,id())]);
    expect(results.filter((result)=>result.status==='fulfilled')).toHaveLength(1);
    expect((await owner.query(`SELECT COALESCE(sum(l.ordered_quantity),0) AS quantity FROM supplier_purchase_order_lines l JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE l.strategic_overbuy_authorization_id=$1 AND p.status='ISSUED'`,[authorization])).rows[0].quantity).toBe('7.0000');
  });

  it('rejects duplicate allocation of one Release line within one multi-line Draft atomically', async () => {
    await fixture();
    const po=await internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[
      {productIdentityId:product,unitId:unit,quantity:70,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:70}]},
      {productIdentityId:product,unitId:unit,quantity:70,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:70}]},
    ],undefined,id());
    await expect(internal.issueSupplierPurchaseOrder(actor,po,id())).rejects.toThrow('SUPPLIER_PO_RELEASE_QUANTITY_EXCEEDED');
    expect((await owner.query(`SELECT status FROM supplier_purchase_orders WHERE id=$1`,[po])).rows[0].status).toBe('DRAFT');
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id WHERE a.supplier_purchase_order_line_id IN (SELECT id FROM supplier_purchase_order_lines WHERE supplier_purchase_order_id=$1)`,[po])).rows[0].count).toBe(0);
  });

  it.each([[40,30],[50,50]])('accepts valid aggregate allocations %i + %i for one Release line', async (first:number, second:number) => {
    await fixture();
    const po=await internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[
      {productIdentityId:product,unitId:unit,quantity:first,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:first}]},
      {productIdentityId:product,unitId:unit,quantity:second,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:second}]},
    ],undefined,id());
    await internal.issueSupplierPurchaseOrder(actor,po,id());
    expect((await owner.query(`SELECT status FROM supplier_purchase_orders WHERE id=$1`,[po])).rows[0].status).toBe('ISSUED');
    expect((await owner.query(`SELECT sum(allocated_quantity) AS quantity FROM supplier_po_release_line_allocations WHERE supplier_purchase_order_line_id IN (SELECT id FROM supplier_purchase_order_lines WHERE supplier_purchase_order_id=$1)`,[po])).rows[0].quantity).toBe(String(first+second)+'.0000');
  });

  it('accepts previously issued 30 plus current 40 + 30 exactly at released quantity', async () => {
    await fixture();
    const first=await internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[{productIdentityId:product,unitId:unit,quantity:30,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:30}]}],undefined,id());
    await internal.issueSupplierPurchaseOrder(actor,first,id());
    const current=await internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[
      {productIdentityId:product,unitId:unit,quantity:40,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:40}]},
      {productIdentityId:product,unitId:unit,quantity:30,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:30}]},
    ],undefined,id());
    await internal.issueSupplierPurchaseOrder(actor,current,id());
    expect((await owner.query(`SELECT COALESCE(sum(a.allocated_quantity),0) AS quantity FROM supplier_po_release_line_allocations a JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE a.procurement_release_line_id=$1 AND p.status='ISSUED'`,[releaseLine])).rows[0].quantity).toBe('100.0000');
  });

  it('rejects previously issued 40 plus current 40 + 30 atomically', async () => {
    await fixture();
    const first=await internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[{productIdentityId:product,unitId:unit,quantity:40,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:40}]}],undefined,id());
    await internal.issueSupplierPurchaseOrder(actor,first,id());
    const current=await internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[
      {productIdentityId:product,unitId:unit,quantity:40,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:40}]},
      {productIdentityId:product,unitId:unit,quantity:30,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:30}]},
    ],undefined,id());
    await expect(internal.issueSupplierPurchaseOrder(actor,current,id())).rejects.toThrow('SUPPLIER_PO_RELEASE_QUANTITY_EXCEEDED');
    expect((await owner.query(`SELECT status FROM supplier_purchase_orders WHERE id=$1`,[current])).rows[0].status).toBe('DRAFT');
    expect((await owner.query(`SELECT count(*)::int AS count FROM supplier_po_coverage_bindings b JOIN supplier_po_release_line_allocations a ON a.id=b.supplier_po_release_line_allocation_id JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id WHERE l.supplier_purchase_order_id=$1`,[current])).rows[0].count).toBe(0);
  });

  it('prevents two concurrent Supplier POs from jointly exceeding one Release line', async () => {
    await fixture();
    const create=()=>internal.createSupplierPurchaseOrderDraft(actor,source,'SAR',[{productIdentityId:product,unitId:unit,quantity:70,actualUnitPurchaseCost:1,releaseAllocations:[{releaseLineId:releaseLine,quantity:70}]}],undefined,id());
    const [poA,poB]=await Promise.all([create(),create()]);
    const results=await Promise.allSettled([internal.issueSupplierPurchaseOrder(actor,poA,id()),internal.issueSupplierPurchaseOrder(actor,poB,id())]);
    expect(results.filter((result)=>result.status==='fulfilled')).toHaveLength(1);
    expect(Number((await owner.query(`SELECT COALESCE(sum(a.allocated_quantity),0) AS quantity FROM supplier_po_release_line_allocations a JOIN supplier_purchase_order_lines l ON l.id=a.supplier_purchase_order_line_id JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id WHERE a.procurement_release_line_id=$1 AND p.status='ISSUED'`,[releaseLine])).rows[0].quantity)).toBe(70);
  });
});
