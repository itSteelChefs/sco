import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { InternalDatabaseService } from '../../src/database/internal-database.service.js';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const id = () => randomUUID();
let internal: InternalDatabaseService;
let sco: string; let actor: string; let lineageActor: string; let partnerA: string; let partnerB: string;
let unit: string; let product: string; let otherProduct: string; let otherUnit: string;
let needA: string; let needB: string; let executionA: string; let commitmentLineA: string; let commitmentLineB: string;
let runKey: string;

async function principal(companyId: string, permissions: string[], prefix: string) {
  const user = id(), membership = id(), role = id();
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`, [user, `${prefix}-${user}@bp.test`]);
  await owner.query(`INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,'ACTIVE')`, [membership,user,companyId]);
  await owner.query(`INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$3)`, [role,companyId,`${prefix}-${role}`]);
  await owner.query(`INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)`, [id(),companyId,membership,role]);
  for (const permission of permissions) await owner.query(`INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4`, [id(),companyId,role,permission]);
  return user;
}

async function commitment(partner: string, productId: string, unitId: string, quantity: number) {
  const offer=id(), revision=id(), po=id(), commitmentId=id(), line=id();
  await owner.query(`INSERT INTO partner_offers(id,company_id,offer_reference,created_by) VALUES($1,$2,$3,$4)`,[offer,partner,`BP-${offer}`,actor]);
  await owner.query(`INSERT INTO partner_offer_revisions(id,partner_offer_id,revision_number,status,currency_code,offer_total_excl_tax,offer_tax_amount,offer_total_incl_tax,created_by) VALUES($1,$2,1,'ACCEPTED','SAR',$3,0,$3,$4)`,[revision,offer,quantity,actor]);
  await owner.query(`INSERT INTO partner_purchase_orders(id,partner_company_id,accepted_offer_id,accepted_offer_revision_id,po_reference,po_date,submitted_by,currency_code,total_excl_tax,total_incl_tax,status) VALUES($1,$2,$3,$4,$5,current_date,$6,'SAR',$7,$7,'VERIFIED')`,[po,partner,offer,revision,`BP-${po}`,actor,quantity]);
  await owner.query(`INSERT INTO commercial_commitments(id,partner_company_id,partner_purchase_order_id,accepted_offer_id,accepted_offer_revision_id,commitment_revision_number,currency_code,total_excl_tax,total_incl_tax,committed_by) VALUES($1,$2,$3,$4,$5,1,'SAR',$6,$6,$7)`,[commitmentId,partner,po,offer,revision,quantity,actor]);
  await owner.query(`INSERT INTO commercial_commitment_lines(id,commercial_commitment_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,amount_excl_tax,amount_incl_tax) VALUES($1,$2,1,$3,'BP',$4,$5,1,$4,$4)`,[line,commitmentId,productId,quantity,unitId]);
  return line;
}

async function mixedNeedFixture(allocation: number, productId = product, unitId = unit) {
  const project = id();
  const need = id();
  await owner.query(
    `INSERT INTO projects(id,company_id,code,name,status,created_by)
     VALUES($1,$2,$3,'BP mixed case','ACTIVE',$4)`,
    [project, partnerA, `BP-${project}`, actor],
  );
  await owner.query(
    `INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,ready_quantity,unit_id,need_date,maturity,review_status)
     VALUES($1,$2,$3,$4,'MANUAL',$5,'mixed case',100,100,$6,current_date,'READY','APPROVED')`,
    [need, partnerA, project, actor, productId, unitId],
  );
  const executionItem = allocation > 0 ? id() : null;
  if (executionItem) await owner.query(
    `INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,current_date,$9,$10,'SOURCING_READY')`,
    [executionItem, executionA, partnerA, project, need, productId, allocation, unitId, id(), actor],
  );
  return { project, need, executionItem };
}

describe('Batch 10-A controlled aggregation foundation', () => {
  beforeAll(async () => {
    internal = new InternalDatabaseService();
    runKey=id();
    sco=id(); partnerA=id(); partnerB=id();
    await owner.query(`INSERT INTO "Company"(id,name,type) VALUES($1,'BP SCO','SCO'),($2,'BP A','PARTNER'),($3,'BP B','PARTNER')`,[sco,partnerA,partnerB]);
    actor=await principal(sco,['buying_power.aggregate','buying_power.rebuild','buying_power.read_summary'],'aggregate');
    lineageActor=await principal(sco,['buying_power.read_lineage'],'lineage');
    const creator=id(), category=id(), category2=id(); unit=id(); otherUnit=id(); product=id(); otherProduct=id();
    await owner.query(`INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,'x')`,[creator,`${creator}@bp.test`]);
    await owner.query(`INSERT INTO product_categories(id,code,name) VALUES($1,$2,'BP'),($3,$4,'BP2')`,[category,`bp-${category}`,category2,`bp-${category2}`]);
    await owner.query(`INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,'Each','count'),($3,$4,'Box','count')`,[unit,`bp-${unit}`,otherUnit,`bp-${otherUnit}`]);
    await owner.query(`INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$2,$3,$4,'ACTIVE'),($5,$6,$3,$4,'ACTIVE')`,[product,category,unit,creator,otherProduct,category2]);
    const projectA=id(), projectB=id(); needA=id(); needB=id();
    await owner.query(`INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,'BP','ACTIVE',$4),($5,$6,$7,'BP','ACTIVE',$4)`,[projectA,partnerA,`BP-${projectA}`,creator,projectB,partnerB,`BP-${projectB}`]);
    await owner.query(`INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,ready_quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,'MANUAL',$5,'A',100,100,$6,current_date,'READY','APPROVED'),($7,$8,$9,$4,'MANUAL',$5,'B',100,100,$6,current_date,'READY','APPROVED')`,[needA,partnerA,projectA,creator,product,unit,needB,partnerB,projectB]);
    const cycle=id(); executionA=id();
    await owner.query(`INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,'BP',now(),now(),'PROCESSING')`,[cycle,`BP-${cycle}`]);
    await owner.query(`INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,'SOURCING_READY',$3)`,[executionA,cycle,creator]);
    await owner.query(`INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,30,30,$7,current_date,$8,$9,'SOURCING_READY')`,[id(),executionA,partnerA,projectA,needA,product,unit,id(),creator]);
    commitmentLineA=await commitment(partnerA,product,unit,100); commitmentLineB=await commitment(partnerB,product,unit,100);
  });
  afterAll(async()=>{ await internal?.onModuleDestroy(); await owner.end(); });

  it('creates explicit partial Need conversion and computes remaining quantity without plan double counting', async () => {
    await expect(internal.createBuyingPowerConversion(actor,commitmentLineA,'NEED',needA,40,id())).resolves.toBeTruthy();
    const row=(await owner.query(`SELECT converted_quantity FROM commitment_demand_conversion_allocations WHERE commitment_line_id=$1`,[commitmentLineA])).rows[0];
    expect(row.converted_quantity).toBe('40.0000');
    const remaining=(await owner.query(`SELECT n.quantity-COALESCE(sum(a.converted_quantity),0) AS remaining FROM procurement_needs n LEFT JOIN commitment_demand_conversion_allocations a ON a.source_type='NEED' AND a.source_id=n.id WHERE n.id=$1 GROUP BY n.quantity`,[needA])).rows[0];
    expect(remaining.remaining).toBe('60.0000');
    await internal.createBuyingPowerConversion(actor,commitmentLineA,'NEED',needA,20,id());
    const afterSecond=(await owner.query(`SELECT n.quantity-COALESCE(sum(a.converted_quantity),0) AS remaining FROM procurement_needs n LEFT JOIN commitment_demand_conversion_allocations a ON a.source_type='NEED' AND a.source_id=n.id WHERE n.id=$1 GROUP BY n.quantity`,[needA])).rows[0];
    expect(afterSecond.remaining).toBe('40.0000');
  });

  it('rejects overflow, wrong product/unit, and cross-tenant demand conversion', async () => {
    await expect(internal.createBuyingPowerConversion(actor,commitmentLineA,'NEED',needA,61,id())).rejects.toThrow('BUYING_POWER_CONVERSION_COMMITMENT_EXCEEDED');
    const secondCommitment=await commitment(partnerA,product,unit,100);
    await expect(internal.createBuyingPowerConversion(actor,secondCommitment,'NEED',needA,61,id())).rejects.toThrow('BUYING_POWER_CONVERSION_SOURCE_EXCEEDED');
    await expect(internal.createBuyingPowerConversion(actor,secondCommitment,'NEED',needA,0,id())).rejects.toThrow('BUYING_POWER_CONVERSION_INVALID');
    await expect(internal.createBuyingPowerConversion(actor,secondCommitment,'NEED',needA,-1,id())).rejects.toThrow('BUYING_POWER_CONVERSION_INVALID');
    await expect(internal.createBuyingPowerConversion(actor,commitmentLineA,'NEED',needB,1,id())).rejects.toThrow('BUYING_POWER_CONVERSION_TENANT_MISMATCH');
    await expect(internal.createBuyingPowerConversion(actor,commitmentLineB,'NEED',needA,1,id())).rejects.toThrow('BUYING_POWER_CONVERSION_TENANT_MISMATCH');
    const mismatched=await commitment(partnerA,otherProduct,unit,10);
    await expect(internal.createBuyingPowerConversion(actor,mismatched,'NEED',needA,1,id())).rejects.toThrow('BUYING_POWER_CONVERSION_PRODUCT_MISMATCH');
  });

  it('records an explicit external commitment without reducing a Need', async () => {
    await internal.createBuyingPowerConversion(actor,commitmentLineB,'EXTERNAL',null,100,id());
    expect((await owner.query(`SELECT count(*)::int count FROM commitment_demand_conversion_allocations WHERE commitment_line_id=$1 AND source_type='EXTERNAL'`,[commitmentLineB])).rows[0].count).toBe(1);
    expect((await owner.query(`SELECT COALESCE(sum(converted_quantity),0) amount FROM commitment_demand_conversion_allocations WHERE source_type='NEED' AND source_id=$1`,[needA])).rows[0].amount).toBe('60.0000');
  });

  it('keeps execution lineage explicit and rejects unit mismatch without treating plan or downstream rows as sources', async () => {
    const plan=id();
    await owner.query(`INSERT INTO procurement_plans(id,company_id,name,status,created_by) VALUES($1,$2,'BP','ACTIVE',$3)`,[plan,partnerA,actor]);
    await owner.query(`INSERT INTO procurement_plan_items(id,company_id,plan_id,need_id,planned_quantity,need_date,maturity) VALUES($1,$2,$3,$4,100,current_date,'READY')`,[id(),partnerA,plan,needA]);
    const executionCommitment=await commitment(partnerA,product,unit,30);
    await internal.createBuyingPowerConversion(actor,executionCommitment,'EXECUTION_ITEM',(await owner.query(`SELECT id FROM procurement_execution_items WHERE execution_id=$1`,[executionA])).rows[0].id,30,id());
    expect((await owner.query(`SELECT source_type,source_id FROM commitment_demand_conversion_allocations WHERE commitment_line_id=$1`,[executionCommitment])).rows[0].source_type).toBe('EXECUTION_ITEM');
    const wrongUnitCommitment=await commitment(partnerA,product,otherUnit,10);
    await expect(internal.createBuyingPowerConversion(actor,wrongUnitCommitment,'NEED',needA,1,id())).rejects.toThrow('BUYING_POWER_CONVERSION_UNIT_MISMATCH');
    expect((await owner.query(`SELECT count(*)::int count FROM commitment_demand_conversion_allocations WHERE source_type NOT IN ('NEED','EXECUTION_ITEM','EXTERNAL')`)).rows[0].count).toBe(0);
  });

  it('publishes one idempotent internal snapshot with confidential lineage', async () => {
    const first=await internal.runBuyingPowerFoundation(actor,'ROLLING_PLANNED','2031-01-05',`bp-run-${runKey}`,[commitmentLineA,commitmentLineB],id());
    const retry=await internal.runBuyingPowerFoundation(actor,'ROLLING_PLANNED','2031-01-05',`bp-run-${runKey}`,[commitmentLineA,commitmentLineB],id());
    expect(retry.snapshotId).toBe(first.snapshotId);
    expect((await owner.query(`SELECT count(*)::int count FROM buying_power_snapshot_source_memberships WHERE snapshot_id=$1`,[first.snapshotId])).rows[0].count).toBe(3);
    expect((await internal.getBuyingPowerSummary(actor,first.snapshotId)).length).toBe(1);
    expect((await internal.getBuyingPowerLineage(lineageActor,first.snapshotId)).length).toBe(3);
    expect(await internal.getBuyingPowerLineage(actor,first.snapshotId)).toEqual([]);
    const run=(await owner.query(`SELECT status,initiated_by,horizon,time_bucket,request_key,source_fingerprint,cutoff_at,correlation_id FROM buying_power_aggregation_runs WHERE id=$1`,[first.runId])).rows[0];
    expect(run.status).toBe('PUBLISHED'); expect(run.initiated_by).toBe(actor); expect(run.request_key).toBe(`bp-run-${runKey}`); expect(run.source_fingerprint).toMatch(/^[a-f0-9]{32}$/); expect(run.cutoff_at).toBeTruthy();
    const audit=(await owner.query(`SELECT action,actor_user_id,correlation_id,metadata FROM audit_logs WHERE entity_id IN($1,$2) AND action IN('buying_power.aggregation.started','buying_power.aggregation.published') ORDER BY created_at`,[first.runId,first.snapshotId])).rows;
    expect(audit.map((row)=>row.action)).toEqual(['buying_power.aggregation.started','buying_power.aggregation.published']); expect(audit.every((row)=>row.actor_user_id===actor)).toBe(true);
  });

  it('serializes concurrent retries and never publishes a failed empty run', async () => {
    const concurrentKey=`bp-concurrent-${runKey}`;
    const attempts=await Promise.all([internal.runBuyingPowerFoundation(actor,'WEEKLY_IMMEDIATE','2031-01-12',concurrentKey,[commitmentLineA],id()),internal.runBuyingPowerFoundation(actor,'WEEKLY_IMMEDIATE','2031-01-12',concurrentKey,[commitmentLineA],id())]);
    expect(new Set(attempts.map((attempt)=>attempt.snapshotId)).size).toBe(1);
    expect((await owner.query(`SELECT count(*)::int count FROM buying_power_aggregation_runs WHERE request_key=$1`,[concurrentKey])).rows[0].count).toBe(1);
    const before=(await owner.query(`SELECT count(*)::int count FROM buying_power_snapshots`)).rows[0].count;
    await expect(internal.runBuyingPowerFoundation(actor,'ROLLING_PLANNED','2031-01-19','bp-empty',[id()],id())).rejects.toThrow('BUYING_POWER_AGGREGATION_EMPTY');
    expect((await owner.query(`SELECT count(*)::int count FROM buying_power_snapshots`)).rows[0].count).toBe(before);
    expect((await owner.query(`SELECT count(*)::int count FROM buying_power_snapshot_source_memberships m JOIN buying_power_snapshots s ON s.id=m.snapshot_id WHERE s.aggregation_run_id IN(SELECT id FROM buying_power_aggregation_runs WHERE request_key=$1)`,[concurrentKey])).rows[0].count).toBeGreaterThan(0);
    await expect(internal.runBuyingPowerFoundation(actor,'WEEKLY_IMMEDIATE','2031-01-12',concurrentKey,[commitmentLineB],id())).rejects.toThrow('BUYING_POWER_IDEMPOTENCY_CONFLICT');
  });

  it('denies direct runtime access and immutable snapshot mutation', async () => {
    const snapshot=(await owner.query(`SELECT id FROM buying_power_snapshots ORDER BY created_at DESC LIMIT 1`)).rows[0].id;
    const runtime=new Client({connectionString:process.env.RUNTIME_DATABASE_URL}); await runtime.connect();
    try {
      await expect(runtime.query(`SELECT * FROM buying_power_snapshot_source_memberships`)).rejects.toThrow(/permission denied/i);
      await runtime.query('BEGIN'); await runtime.query("SELECT set_config('app.sco_internal','true',true),set_config('app.actor_id',$1,true)",[lineageActor]);
      await expect(runtime.query(`SELECT public.internal_buying_power_snapshot_lineage_get($1,$2)`,[lineageActor,snapshot])).rejects.toThrow(/permission denied/i); await runtime.query('ROLLBACK');
    } finally { await runtime.end(); }
    await expect(owner.query(`UPDATE buying_power_snapshots SET source_fingerprint='x' WHERE id=$1`,[snapshot])).rejects.toThrow('BUYING_POWER_HISTORY_IMMUTABLE');
    const membership=(await owner.query(`SELECT id FROM buying_power_snapshot_source_memberships WHERE snapshot_id=$1 LIMIT 1`,[snapshot])).rows[0].id;
    await expect(owner.query(`UPDATE buying_power_snapshot_source_memberships SET contribution_quantity=1 WHERE id=$1`,[membership])).rejects.toThrow('BUYING_POWER_HISTORY_IMMUTABLE');
    await expect(owner.query(`DELETE FROM buying_power_snapshot_source_memberships WHERE id=$1`,[membership])).rejects.toThrow('BUYING_POWER_HISTORY_IMMUTABLE');
    const rebuilt=await internal.runBuyingPowerFoundation(actor,'ROLLING_PLANNED','2031-02-02',`bp-rebuild-${runKey}`,[commitmentLineA],id());
    expect(rebuilt.snapshotId).not.toBe(snapshot);
    expect((await owner.query(`SELECT count(*)::int count FROM buying_power_snapshots WHERE id IN($1,$2)`,[snapshot,rebuilt.snapshotId])).rows[0].count).toBe(2);
  });

  it('keeps all Batch 10-A tables forced behind narrow gateways and does not create downstream procurement', async () => {
    const rls=(await owner.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN('commitment_demand_conversion_allocations','buying_power_aggregation_runs','buying_power_snapshots','buying_power_snapshot_lines','buying_power_snapshot_source_memberships')`)).rows;
    expect(rls).toHaveLength(5); expect(rls.every((row)=>row.relrowsecurity&&row.relforcerowsecurity)).toBe(true);
    const acl=(await owner.query(`SELECT has_function_privilege('public','public.internal_buying_power_foundation_run(uuid,text,date,text,uuid[],text)','EXECUTE') AS public_execute,has_function_privilege('sco_runtime','public.internal_buying_power_foundation_run(uuid,text,date,text,uuid[],text)','EXECUTE') AS runtime_execute`)).rows[0];
    expect(acl).toEqual({public_execute:false,runtime_execute:false});
    const objects=(await owner.query(`SELECT to_regclass('public.supplier_payment_executions') AS payment_execution`)).rows[0];
    expect(objects.payment_execution).toBeNull();
  });

  it('has no Partner projection or generic cross-tenant gateway and returns safe empty internal reads without capability', async () => {
    const snapshot=(await owner.query(`SELECT id FROM buying_power_snapshots ORDER BY created_at DESC LIMIT 1`)).rows[0].id;
    const partnerActor=await principal(partnerA,[],'no-buying-power');
    expect(await internal.getBuyingPowerSummary(partnerActor,snapshot)).toEqual([]);
    expect(await internal.getBuyingPowerLineage(partnerActor,snapshot)).toEqual([]);
    const functions=(await owner.query(`SELECT proname,proconfig FROM pg_proc WHERE proname IN('partner_buying_power_projection','internal_buying_power_foundation_run') ORDER BY proname`)).rows;
    expect(functions.map((row)=>row.proname)).toEqual(['internal_buying_power_foundation_run']);
    expect(functions[0].proconfig).toContain('search_path=pg_catalog, public');
    await expect(internal.createBuyingPowerConversion(partnerA,commitmentLineA,'NEED',needA,1,id())).rejects.toThrow('BUYING_POWER_AGGREGATION_FORBIDDEN');
    await expect(internal.runBuyingPowerFoundation(lineageActor,'ROLLING_PLANNED','2031-03-01',`bp-no-aggregate-${runKey}`,[commitmentLineA],id())).rejects.toThrow('BUYING_POWER_AGGREGATION_FORBIDDEN');
  });

  it('records only the legitimate committed foundation and leaves all downstream domains unchanged', async () => {
    const before={ commitments:(await owner.query(`SELECT count(*)::int count FROM commercial_commitments`)).rows[0].count, releases:(await owner.query(`SELECT count(*)::int count FROM procurement_releases`)).rows[0].count, pos:(await owner.query(`SELECT count(*)::int count FROM supplier_purchase_orders`)).rows[0].count, coverage:(await owner.query(`SELECT count(*)::int count FROM supplier_po_coverage_bindings`)).rows[0].count, confirmations:(await owner.query(`SELECT count(*)::int count FROM supplier_po_line_confirmation_events`)).rows[0].count, paymentScheduleRevisions:(await owner.query(`SELECT count(*)::int count FROM supplier_payment_schedule_revisions`)).rows[0].count, paymentScheduleItems:(await owner.query(`SELECT count(*)::int count FROM supplier_payment_schedule_items`)).rows[0].count, commercialDocuments:(await owner.query(`SELECT count(*)::int count FROM supplier_po_commercial_documents`)).rows[0].count };
    const result=await internal.runBuyingPowerFoundation(actor,'ROLLING_PLANNED','2031-04-01',`bp-isolation-${runKey}`,[commitmentLineA],id());
    expect((await owner.query(`SELECT committed_quantity,potential_quantity,qualified_quantity,open_quantity,released_quantity,procured_quantity FROM buying_power_snapshot_lines WHERE snapshot_id=$1`,[result.snapshotId])).rows[0]).toMatchObject({committed_quantity:'60.0000',potential_quantity:null,qualified_quantity:null,open_quantity:null,released_quantity:null,procured_quantity:null});
    const after={ commitments:(await owner.query(`SELECT count(*)::int count FROM commercial_commitments`)).rows[0].count, releases:(await owner.query(`SELECT count(*)::int count FROM procurement_releases`)).rows[0].count, pos:(await owner.query(`SELECT count(*)::int count FROM supplier_purchase_orders`)).rows[0].count, coverage:(await owner.query(`SELECT count(*)::int count FROM supplier_po_coverage_bindings`)).rows[0].count, confirmations:(await owner.query(`SELECT count(*)::int count FROM supplier_po_line_confirmation_events`)).rows[0].count, paymentScheduleRevisions:(await owner.query(`SELECT count(*)::int count FROM supplier_payment_schedule_revisions`)).rows[0].count, paymentScheduleItems:(await owner.query(`SELECT count(*)::int count FROM supplier_payment_schedule_items`)).rows[0].count, commercialDocuments:(await owner.query(`SELECT count(*)::int count FROM supplier_po_commercial_documents`)).rows[0].count };
    expect(after).toEqual(before);
  });

  it('rejects mixed Need and Execution Item conversions that over-consume one economic demand root', async () => {
    const project = id();
    const need = id();
    const executionItem = id();
    const executionCommitment = await commitment(partnerA, product, unit, 40);
    const needCommitment = await commitment(partnerA, product, unit, 80);

    await owner.query(
      `INSERT INTO projects(id,company_id,code,name,status,created_by)
       VALUES($1,$2,$3,'BP mixed lineage','ACTIVE',$4)`,
      [project, partnerA, `BP-${project}`, actor],
    );
    await owner.query(
      `INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,ready_quantity,unit_id,need_date,maturity,review_status)
       VALUES($1,$2,$3,$4,'MANUAL',$5,'mixed lineage',100,100,$6,current_date,'READY','APPROVED')`,
      [need, partnerA, project, actor, product, unit],
    );
    await owner.query(
      `INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status)
       VALUES($1,$2,$3,$4,$5,$6,40,40,$7,$8,$9,$10,'SOURCING_READY')`,
      [executionItem, executionA, partnerA, project, need, product, unit, new Date(), id(), actor],
    );

    await internal.createBuyingPowerConversion(actor, executionCommitment, 'EXECUTION_ITEM', executionItem, 40, id());

    // 40 units are reserved for the weekly execution path; only 60 remain
    // available for direct Need conversion. The 80-unit request must reject.
    await expect(
      internal.createBuyingPowerConversion(actor, needCommitment, 'NEED', need, 80, id()),
    ).rejects.toThrow();
  });

  it('allows 25 execution-linked plus 60 direct Need units from a 100-unit root', async () => {
    const fixture = await mixedNeedFixture(40);
    const executionLine = await commitment(partnerA, product, unit, 25);
    const needLine = await commitment(partnerA, product, unit, 60);
    await internal.createBuyingPowerConversion(actor, executionLine, 'EXECUTION_ITEM', fixture.executionItem, 25, id());
    await internal.createBuyingPowerConversion(actor, needLine, 'NEED', fixture.need, 60, id());
    const totals = (await owner.query(
      `SELECT source_type, sum(converted_quantity) AS total
         FROM commitment_demand_conversion_allocations
        WHERE source_id IN ($1,$2)
        GROUP BY source_type`,
      [fixture.need, fixture.executionItem],
    )).rows;
    expect(totals).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_type: 'NEED', total: '60.0000' }),
      expect.objectContaining({ source_type: 'EXECUTION_ITEM', total: '25.0000' }),
    ]));
  });

  it('rejects 25 execution-linked plus 80 direct Need units from a 100-unit root', async () => {
    const fixture = await mixedNeedFixture(40);
    const executionLine = await commitment(partnerA, product, unit, 25);
    const needLine = await commitment(partnerA, product, unit, 80);
    await internal.createBuyingPowerConversion(actor, executionLine, 'EXECUTION_ITEM', fixture.executionItem, 25, id());
    await expect(internal.createBuyingPowerConversion(actor, needLine, 'NEED', fixture.need, 80, id())).rejects.toThrow('BUYING_POWER_CONVERSION_SOURCE_EXCEEDED');
  });

  it('rejects direct Need conversion above reserved capacity even without execution-linked commitment', async () => {
    const fixture = await mixedNeedFixture(40);
    const needLine = await commitment(partnerA, product, unit, 70);
    await expect(internal.createBuyingPowerConversion(actor, needLine, 'NEED', fixture.need, 70, id())).rejects.toThrow('BUYING_POWER_CONVERSION_SOURCE_EXCEEDED');
  });

  it('aggregates multiple execution reservations before allowing direct Need conversion', async () => {
    const fixture = await mixedNeedFixture(25);
    const secondExecutionItem = id();
    await owner.query(
      `INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status)
       VALUES($1,$2,$3,$4,$5,$6,15,15,$7,current_date,$8,$9,'SOURCING_READY')`,
      [secondExecutionItem, executionA, partnerA, fixture.project, fixture.need, product, unit, id(), actor],
    );
    const executionLineA = await commitment(partnerA, product, unit, 25);
    const executionLineB = await commitment(partnerA, product, unit, 15);
    const needLine = await commitment(partnerA, product, unit, 60);
    await internal.createBuyingPowerConversion(actor, executionLineA, 'EXECUTION_ITEM', fixture.executionItem, 25, id());
    await internal.createBuyingPowerConversion(actor, executionLineB, 'EXECUTION_ITEM', secondExecutionItem, 15, id());
    await internal.createBuyingPowerConversion(actor, needLine, 'NEED', fixture.need, 60, id());
    expect((await owner.query(`SELECT sum(converted_quantity) AS total FROM commitment_demand_conversion_allocations WHERE source_id IN ($1,$2)`, [fixture.executionItem, secondExecutionItem])).rows[0].total).toBe('40.0000');
  });

  it('keeps EXTERNAL commitment independent from Need reservation capacity', async () => {
    const fixture = await mixedNeedFixture(40);
    const externalLine = await commitment(partnerA, product, unit, 50);
    const needLine = await commitment(partnerA, product, unit, 60);
    await internal.createBuyingPowerConversion(actor, externalLine, 'EXTERNAL', null, 50, id());
    await internal.createBuyingPowerConversion(actor, needLine, 'NEED', fixture.need, 60, id());
    expect((await owner.query(`SELECT count(*)::int AS count FROM commitment_demand_conversion_allocations WHERE commitment_line_id=$1 AND source_type='EXTERNAL'`, [externalLine])).rows[0].count).toBe(1);
  });

  it('serializes concurrent direct conversions against the reserved Need capacity', async () => {
    const fixture = await mixedNeedFixture(40);
    const lineA = await commitment(partnerA, product, unit, 40);
    const lineB = await commitment(partnerA, product, unit, 40);
    const results = await Promise.allSettled([
      internal.createBuyingPowerConversion(actor, lineA, 'NEED', fixture.need, 40, id()),
      internal.createBuyingPowerConversion(actor, lineB, 'NEED', fixture.need, 40, id()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await owner.query(`SELECT sum(converted_quantity) AS total FROM commitment_demand_conversion_allocations WHERE source_type='NEED' AND source_id=$1`, [fixture.need])).rows[0].total).toBe('40.0000');
  });

  it('classifies maturity and weekly/rolling partitions without double counting the root Need', async () => {
    const forecast = await mixedNeedFixture(0);
    const planned = await mixedNeedFixture(0);
    const approved = await mixedNeedFixture(0);
    const ready = await mixedNeedFixture(40);
    await owner.query(`UPDATE procurement_needs SET need_date='2032-01-15' WHERE id = ANY($1::uuid[])`, [[forecast.need, planned.need, approved.need, ready.need]]);
    await owner.query(`UPDATE procurement_needs SET maturity='FORECAST' WHERE id=$1`, [forecast.need]);
    await owner.query(`UPDATE procurement_needs SET maturity='PLANNED' WHERE id=$1`, [planned.need]);
    await owner.query(`UPDATE procurement_needs SET maturity='APPROVED' WHERE id=$1`, [approved.need]);
    await owner.query(`UPDATE procurement_needs SET maturity='READY' WHERE id=$1`, [ready.need]);
    const weekly = await internal.runBuyingPowerClassification(actor, 'WEEKLY_IMMEDIATE', '2032-01-01', `bp-10b-weekly-${id()}`, [ready.need], []);
    const weeklyLine = (await internal.getBuyingPowerClassifiedSummary(actor, weekly.snapshotId))[0];
    expect(weeklyLine.open_quantity).toBe('40.0000');
    const rolling = await internal.runBuyingPowerClassification(actor, 'ROLLING_PLANNED', '2032-01-01', `bp-10b-rolling-${id()}`, [forecast.need, planned.need, approved.need, ready.need], []);
    const rollingLines = await internal.getBuyingPowerClassifiedSummary(actor, rolling.snapshotId);
    expect(rollingLines.reduce((sum, line) => sum + Number(line.potential_quantity ?? 0), 0)).toBe(200);
    expect(rollingLines.reduce((sum, line) => sum + Number(line.qualified_quantity ?? 0), 0)).toBe(160);
    expect(rollingLines.reduce((sum, line) => sum + Number(line.open_quantity ?? 0), 0)).toBe(360);
  });

  it('includes only needs inside the selected rolling 90-day need-date window', async () => {
    const inWindow = await mixedNeedFixture(0);
    const outOfWindow = await mixedNeedFixture(0);
    await owner.query(`UPDATE procurement_needs SET need_date='2032-01-15' WHERE id=$1`, [inWindow.need]);
    await owner.query(`UPDATE procurement_needs SET need_date='2032-06-15' WHERE id=$1`, [outOfWindow.need]);
    const result = await internal.runBuyingPowerClassification(actor, 'ROLLING_PLANNED', '2032-01-01', `bp-10b-window-${id()}`, [inWindow.need, outOfWindow.need], []);
    const summary = await internal.getBuyingPowerClassifiedSummary(actor, result.snapshotId);
    expect(summary.reduce((sum, line) => sum + Number(line.open_quantity ?? 0), 0)).toBe(100);
  });

  it('uses the deterministic half-open 90-day rolling boundary', async () => {
    const dates = ['2032-01-01', '2032-01-02', '2032-03-30', '2032-04-01', '2031-12-31', '2032-04-02'];
    const fixtures = await Promise.all(dates.map(() => mixedNeedFixture(0)));
    await Promise.all(fixtures.map((fixture, index) => owner.query(`UPDATE procurement_needs SET need_date=$1 WHERE id=$2`, [dates[index], fixture.need])));
    const result = await internal.runBuyingPowerClassification(actor, 'ROLLING_PLANNED', '2032-01-01', `bp-10b-boundary-${id()}`, fixtures.map((fixture) => fixture.need), []);
    const summary = await internal.getBuyingPowerClassifiedSummary(actor, result.snapshotId);
    expect(summary.reduce((sum, line) => sum + Number(line.open_quantity ?? 0), 0)).toBe(300);
    expect((await owner.query(`SELECT count(*)::int AS count FROM procurement_needs WHERE id=ANY($1::uuid[])`, [fixtures.map((fixture) => fixture.need)])).rows[0].count).toBe(6);
  });

  it('derives released and issued-procured metrics without double counting downstream rows', async () => {
    const basis = (await owner.query(`SELECT s.id,s.product_identity_id,ri.unit_id,s.purchase_source_id,s.supplier_company_id,s.currency_code,s.unit_purchase_cost FROM approved_purchase_cost_snapshots s JOIN rfq_items ri ON ri.id=s.rfq_item_id WHERE s.status='APPROVED' LIMIT 1`)).rows[0];
    expect(basis).toBeTruthy();
    const fixture = await mixedNeedFixture(0, basis.product_identity_id, basis.unit_id);
    await owner.query(`UPDATE procurement_needs SET need_date='2032-01-15' WHERE id=$1`, [fixture.need]);
    const line = await commitment(partnerA, basis.product_identity_id, basis.unit_id, 100);
    await internal.createBuyingPowerConversion(actor, line, 'NEED', fixture.need, 100, id());
    const commitmentId = (await owner.query(`SELECT commercial_commitment_id FROM commercial_commitment_lines WHERE id=$1`, [line])).rows[0].commercial_commitment_id;
    const release = id();
    const releaseLine = id();
    await owner.query(`INSERT INTO procurement_releases(id,commercial_commitment_id,partner_company_id,status,total_required,currency_code,executed_by,executed_at) VALUES($1,$2,$3,'PROCUREMENT_RELEASED',100,'SAR',$4,now())`, [release, commitmentId, partnerA, actor]);
    await owner.query(`INSERT INTO procurement_release_lines(id,release_id,commercial_commitment_line_id,product_identity_id,released_quantity,unit_id,approved_purchase_cost_snapshot_id,purchase_source_id,supplier_company_id,currency_code,unit_purchase_cost) VALUES($1,$2,$3,$4,100,$5,$6,$7,$8,'SAR',$9)`, [releaseLine, release, line, basis.product_identity_id, basis.unit_id, basis.id, basis.purchase_source_id, basis.supplier_company_id, basis.unit_purchase_cost]);
    const draftPo = id();
    const draftLine = id();
    await owner.query(`INSERT INTO supplier_purchase_orders(id,purchase_source_id,supplier_company_id,currency_code,status,created_by) VALUES($1,$2,$3,'SAR','DRAFT',$4)`, [draftPo, basis.purchase_source_id, basis.supplier_company_id, actor]);
    await owner.query(`INSERT INTO supplier_purchase_order_lines(id,supplier_purchase_order_id,demand_origin,product_identity_id,unit_id,ordered_quantity,actual_unit_purchase_cost,currency_code) VALUES($1,$2,'RELEASED_DEMAND',$3,$4,60,$5,'SAR')`, [draftLine, draftPo, basis.product_identity_id, basis.unit_id, basis.unit_purchase_cost]);
    await owner.query(`INSERT INTO supplier_po_release_line_allocations(supplier_purchase_order_line_id,procurement_release_line_id,allocated_quantity,approved_purchase_cost_snapshot_id,original_purchase_source_id,approved_unit_purchase_cost) VALUES($1,$2,60,$3,$4,$5)`, [draftLine, releaseLine, basis.id, basis.purchase_source_id, basis.unit_purchase_cost]);
    const draftSnapshot = await internal.runBuyingPowerClassification(actor, 'ROLLING_PLANNED', '2032-01-01', `bp-10b-release-draft-${id()}`, [fixture.need], [line]);
    const draftSummary = (await internal.getBuyingPowerClassifiedSummary(actor, draftSnapshot.snapshotId))[0];
    expect(draftSummary.released_quantity).toBe('100.0000');
    expect(draftSummary.procured_quantity).toBeNull();
    expect(draftSummary.open_quantity).toBeNull();
    const issuedPo = id();
    const issuedLine = id();
    await owner.query(`INSERT INTO supplier_purchase_orders(id,purchase_source_id,supplier_company_id,currency_code,status,created_by,issued_by,issued_at) VALUES($1,$2,$3,'SAR','ISSUED',$4,$4,now())`, [issuedPo, basis.purchase_source_id, basis.supplier_company_id, actor]);
    await owner.query(`INSERT INTO supplier_purchase_order_lines(id,supplier_purchase_order_id,demand_origin,product_identity_id,unit_id,ordered_quantity,actual_unit_purchase_cost,currency_code) VALUES($1,$2,'RELEASED_DEMAND',$3,$4,60,$5,'SAR')`, [issuedLine, issuedPo, basis.product_identity_id, basis.unit_id, basis.unit_purchase_cost]);
    await owner.query(`INSERT INTO supplier_po_release_line_allocations(supplier_purchase_order_line_id,procurement_release_line_id,allocated_quantity,approved_purchase_cost_snapshot_id,original_purchase_source_id,approved_unit_purchase_cost) VALUES($1,$2,60,$3,$4,$5)`, [issuedLine, releaseLine, basis.id, basis.purchase_source_id, basis.unit_purchase_cost]);
    const issuedSnapshot = await internal.runBuyingPowerClassification(actor, 'ROLLING_PLANNED', '2032-01-01', `bp-10b-release-issued-${id()}`, [fixture.need], [line]);
    const issuedSummary = (await internal.getBuyingPowerClassifiedSummary(actor, issuedSnapshot.snapshotId))[0];
    expect(issuedSummary.released_quantity).toBe('100.0000');
    expect(issuedSummary.procured_quantity).toBe('60.0000');
    expect(Number(issuedSummary.procured_quantity)).toBeLessThanOrEqual(Number(issuedSummary.released_quantity));
  });
});
