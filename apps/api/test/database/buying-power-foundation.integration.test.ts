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
    const before={ commitments:(await owner.query(`SELECT count(*)::int count FROM commercial_commitments`)).rows[0].count, releases:(await owner.query(`SELECT count(*)::int count FROM procurement_releases`)).rows[0].count, pos:(await owner.query(`SELECT count(*)::int count FROM supplier_purchase_orders`)).rows[0].count, coverage:(await owner.query(`SELECT count(*)::int count FROM supplier_po_coverage_bindings`)).rows[0].count, confirmations:(await owner.query(`SELECT count(*)::int count FROM supplier_po_line_confirmation_events`)).rows[0].count, schedules:(await owner.query(`SELECT count(*)::int count FROM supplier_payment_schedules`)).rows[0].count };
    const result=await internal.runBuyingPowerFoundation(actor,'ROLLING_PLANNED','2031-04-01',`bp-isolation-${runKey}`,[commitmentLineA],id());
    expect((await owner.query(`SELECT committed_quantity,potential_quantity,qualified_quantity,open_quantity,released_quantity,procured_quantity FROM buying_power_snapshot_lines WHERE snapshot_id=$1`,[result.snapshotId])).rows[0]).toMatchObject({committed_quantity:'60.0000',potential_quantity:null,qualified_quantity:null,open_quantity:null,released_quantity:null,procured_quantity:null});
    const after={ commitments:(await owner.query(`SELECT count(*)::int count FROM commercial_commitments`)).rows[0].count, releases:(await owner.query(`SELECT count(*)::int count FROM procurement_releases`)).rows[0].count, pos:(await owner.query(`SELECT count(*)::int count FROM supplier_purchase_orders`)).rows[0].count, coverage:(await owner.query(`SELECT count(*)::int count FROM supplier_po_coverage_bindings`)).rows[0].count, confirmations:(await owner.query(`SELECT count(*)::int count FROM supplier_po_line_confirmation_events`)).rows[0].count, schedules:(await owner.query(`SELECT count(*)::int count FROM supplier_payment_schedules`)).rows[0].count };
    expect(after).toEqual(before);
  });
});
