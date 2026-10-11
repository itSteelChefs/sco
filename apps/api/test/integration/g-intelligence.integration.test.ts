import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { AppModule } from '../../src/app.module.js';
import { ApiValidationPipe } from '../../src/common/http/validation-pipe.js';

const id = () => randomUUID();
const password = randomBytes(32).toString('base64url');

let app: NestFastifyApplication;
let owner: Client;
let partner: string;
let supplier: string;
let scoCompany: string;
let unitId: string;
let unitOther: string;
let scoActor: string;
let partnerUser: string;
let quoteLineId: string;
let quoteLineHighId: string;
let quoteLineLowId: string;
let reqId: string;
let reqLineId: string;
let orderId: string;
let orderLineId: string;
let comparableKey: string;

async function grant(userId: string, companyId: string, code: string) {
  const membership = (await owner.query('SELECT id FROM "CompanyMembership" WHERE "userId"=$1 AND "companyId"=$2', [userId, companyId])).rows[0].id;
  const role = id();
  await owner.query('INSERT INTO "Role"(id,company_id,code,name) VALUES($1,$2,$3,$4)', [role, companyId, `${code}-${role}`, code]);
  await owner.query('INSERT INTO "MembershipRole"(id,company_id,membership_id,role_id) VALUES($1,$2,$3,$4)', [id(), companyId, membership, role]);
  await owner.query(
    'INSERT INTO "RolePermission"(id,company_id,role_id,permission_id) SELECT $1,$2,$3,id FROM "Permission" WHERE code=$4',
    [id(), companyId, role, code],
  );
}

async function createUser(companyId: string, permissions: string[]) {
  const userId = id();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await owner.query(`INSERT INTO "User"(id,email,"passwordHash",status) VALUES($1,$2,$3,'ACTIVE')`, [userId, `${userId}@g-core.test`, passwordHash]);
  await owner.query('INSERT INTO "CompanyMembership"(id,"userId","companyId",status) VALUES($1,$2,$3,\'ACTIVE\')', [id(), userId, companyId]);
  for (const permission of permissions) await grant(userId, companyId, permission);
  return userId;
}

async function login(userId: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: `${userId}@g-core.test`, password },
  });
  expect(response.statusCode).toBe(201);
  return response.headers['set-cookie'] as string;
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  partner = id();
  supplier = id();
  scoCompany = id();
  await owner.query(
    `INSERT INTO "Company"(id,name,type,status) VALUES
      ($1,'G Partner','PARTNER','ACTIVE'),
      ($2,'G Supplier','SUPPLIER','ACTIVE'),
      ($3,'G SCO','SCO','ACTIVE')`,
    [partner, supplier, scoCompany],
  );
  unitId = id();
  unitOther = id();
  await owner.query(`INSERT INTO unit_definitions(id,code,name,dimension,active) VALUES ($1,'g-ea','Each','count',true),($2,'g-m','Meter','length',true)`, [
    unitId,
    unitOther,
  ]);

  scoActor = await createUser(scoCompany, [
    'sco.internal.manage',
    'procurement.intelligence.read',
    'procurement.intelligence.refresh',
  ]);
  partnerUser = await createUser(partner, ['partner.portal.read']);

  // D requirement + line + quotes
  reqId = id();
  reqLineId = id();
  await owner.query(
    `INSERT INTO procurement_requirements(id,company_id,created_by,title,sector,delivery_location,status,submitted_at)
     VALUES ($1,$2,$3,'G AHU Req','HVAC','Riyadh','SUBMITTED',now())`,
    [reqId, partner, partnerUser],
  );
  await owner.query(
    `INSERT INTO procurement_requirement_lines(id,requirement_id,company_id,line_key,description,specification,quantity,unit_id,brand_preference,model_preference)
     VALUES ($1,$2,$3,'L1','AHU-01','50 TR',2,$4,'Carrier','X')`,
    [reqLineId, reqId, partner, unitId],
  );

  const mkQuote = async (price: number, currency = 'SAR') => {
    const qid = id();
    const lid = id();
    await owner.query(
      `INSERT INTO procurement_requirement_quotes(id,requirement_id,partner_company_id,supplier_company_id,quote_reference,currency_code,status,received_at,recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,'RECORDED',now()-interval '10 days',$7)`,
      [qid, reqId, partner, supplier, `Q-${lid}`, currency, scoActor],
    );
    await owner.query(
      `INSERT INTO procurement_requirement_quote_lines(id,quote_id,requirement_id,requirement_line_id,match_state,offered_description,offered_quantity,unit_id,unit_price,line_amount,tax_state,value_state)
       VALUES ($1,$2,$3,$4,'MATCHED','AHU-01',2,$5,$6,$7,'EXCL','QUOTED')`,
      [lid, qid, reqId, reqLineId, unitId, price, price * 2],
    );
    return { qid, lid };
  };

  const q1 = await mkQuote(100);
  const q2 = await mkQuote(120);
  const q3 = await mkQuote(140);
  const qHigh = await mkQuote(200);
  const qLow = await mkQuote(50);
  quoteLineId = q2.lid;
  quoteLineHighId = qHigh.lid;
  quoteLineLowId = qLow.lid;

  // selected quote
  const cmp = id();
  await owner.query(
    `INSERT INTO procurement_comparisons(id,requirement_id,partner_company_id,status,generated_by) VALUES ($1,$2,$3,'ACTIVE',$4)`,
    [cmp, reqId, partner, scoActor],
  );
  await owner.query(
    `INSERT INTO procurement_selection_candidates(id,requirement_id,comparison_id,quote_id,alias_label,rationale,selected_by)
     VALUES ($1,$2,$3,$4,'S1','best fit',$5)`,
    [id(), reqId, cmp, q2.qid, scoActor],
  );

  // E PO issued+confirmed
  orderId = id();
  orderLineId = id();
  const intentId = id();
  const intentLineId = id();
  await owner.query(
    `INSERT INTO commercial_purchase_intents(id,selection_candidate_id,requirement_id,partner_company_id,quote_id,supplier_company_id,alias_label,currency_code,status,created_by,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,'S1','SAR','APPROVED',$7,$8)`,
    [intentId, (await owner.query(`SELECT id FROM procurement_selection_candidates WHERE requirement_id=$1`, [reqId])).rows[0].id, reqId, partner, q2.qid, supplier, scoActor, `pi-${intentId}`],
  );
  await owner.query(
    `INSERT INTO commercial_purchase_intent_lines(id,intent_id,quote_line_id,requirement_line_id,description,specification,quantity,unit_id,purchase_unit_price,line_amount,tax_state,value_state)
     VALUES ($1,$2,$3,$4,'AHU-01','50 TR',2,$5,110,220,'EXCL','QUOTED')`,
    [intentLineId, intentId, q2.lid, reqLineId, unitId],
  );
  await owner.query(
    `INSERT INTO commercial_supplier_orders(id,sco_buyer_company_id,supplier_company_id,order_reference,status,currency_code,purchase_subtotal,purchase_total,issued_at,confirmed_at,created_by,idempotency_key)
     VALUES ($1,$2,$3,$4,'CONFIRMED','SAR',220,220,now()-interval '5 days',now()-interval '4 days',$5,$6)`,
    [orderId, scoCompany, supplier, `PO-${orderId}`, scoActor, `po-${orderId}`],
  );
  await owner.query(
    `INSERT INTO commercial_supplier_order_intents(order_id,intent_id) VALUES ($1,$2)`,
    [orderId, intentId],
  );
  await owner.query(
    `INSERT INTO commercial_supplier_order_lines(id,order_id,intent_line_id,quote_line_id,requirement_line_id,partner_company_id,description,specification,ordered_quantity,confirmed_quantity,unit_id,purchase_unit_price,line_amount,tax_state)
     VALUES ($1,$2,$3,$4,$5,$6,'AHU-01','50 TR',2,2,$7,110,220,'EXCL')`,
    [orderLineId, orderId, intentLineId, q2.lid, reqLineId, partner, unitId],
  );

  // cancelled PO (no confirmation) — separate requirement/selection (intent.selection UNIQUE)
  const cancelReq = id();
  const cancelReqLine = id();
  const cancelQuote = id();
  const cancelQuoteLine = id();
  const cancelCmp = id();
  const cancelSel = id();
  const cancelOrder = id();
  const cancelLine = id();
  const cancelIntent = id();
  const cancelIntentLine = id();
  await owner.query(
    `INSERT INTO procurement_requirements(id,company_id,created_by,title,sector,delivery_location,status,submitted_at)
     VALUES ($1,$2,$3,'G Cancel Req','HVAC','Riyadh','SUBMITTED',now())`,
    [cancelReq, partner, partnerUser],
  );
  await owner.query(
    `INSERT INTO procurement_requirement_lines(id,requirement_id,company_id,line_key,description,specification,quantity,unit_id,brand_preference,model_preference)
     VALUES ($1,$2,$3,'L1','AHU-01','50 TR',1,$4,'Carrier','X')`,
    [cancelReqLine, cancelReq, partner, unitId],
  );
  await owner.query(
    `INSERT INTO procurement_requirement_quotes(id,requirement_id,partner_company_id,supplier_company_id,quote_reference,currency_code,status,received_at,recorded_by)
     VALUES ($1,$2,$3,$4,'Q-C','SAR','RECORDED',now(),$5)`,
    [cancelQuote, cancelReq, partner, supplier, scoActor],
  );
  await owner.query(
    `INSERT INTO procurement_requirement_quote_lines(id,quote_id,requirement_id,requirement_line_id,match_state,offered_description,offered_quantity,unit_id,unit_price,line_amount,tax_state,value_state)
     VALUES ($1,$2,$3,$4,'MATCHED','AHU-01',1,$5,100,100,'EXCL','QUOTED')`,
    [cancelQuoteLine, cancelQuote, cancelReq, cancelReqLine, unitId],
  );
  await owner.query(
    `INSERT INTO procurement_comparisons(id,requirement_id,partner_company_id,status,generated_by) VALUES ($1,$2,$3,'ACTIVE',$4)`,
    [cancelCmp, cancelReq, partner, scoActor],
  );
  await owner.query(
    `INSERT INTO procurement_selection_candidates(id,requirement_id,comparison_id,quote_id,alias_label,rationale,selected_by)
     VALUES ($1,$2,$3,$4,'S1','cancel path',$5)`,
    [cancelSel, cancelReq, cancelCmp, cancelQuote, scoActor],
  );
  await owner.query(
    `INSERT INTO commercial_purchase_intents(id,selection_candidate_id,requirement_id,partner_company_id,quote_id,supplier_company_id,alias_label,currency_code,status,created_by,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,'S1','SAR','CANCELLED',$7,$8)`,
    [cancelIntent, cancelSel, cancelReq, partner, cancelQuote, supplier, scoActor, `pi-${cancelIntent}`],
  );
  await owner.query(
    `INSERT INTO commercial_purchase_intent_lines(id,intent_id,quote_line_id,requirement_line_id,description,specification,quantity,unit_id,purchase_unit_price,line_amount,tax_state,value_state)
     VALUES ($1,$2,$3,$4,'AHU-01','50 TR',1,$5,100,100,'EXCL','QUOTED')`,
    [cancelIntentLine, cancelIntent, cancelQuoteLine, cancelReqLine, unitId],
  );
  await owner.query(
    `INSERT INTO commercial_supplier_orders(id,sco_buyer_company_id,supplier_company_id,order_reference,status,currency_code,issued_at,created_by,idempotency_key)
     VALUES ($1,$2,$3,$4,'CANCELLED','SAR',now()-interval '3 days',$5,$6)`,
    [cancelOrder, scoCompany, supplier, `PO-C-${cancelOrder}`, scoActor, `po-${cancelOrder}`],
  );
  await owner.query(`INSERT INTO commercial_supplier_order_intents(order_id,intent_id) VALUES ($1,$2)`, [cancelOrder, cancelIntent]);
  await owner.query(
    `INSERT INTO commercial_supplier_order_lines(id,order_id,intent_line_id,quote_line_id,requirement_line_id,partner_company_id,description,specification,ordered_quantity,unit_id,purchase_unit_price,line_amount,tax_state)
     VALUES ($1,$2,$3,$4,$5,$6,'AHU-01','50 TR',1,$7,100,100,'EXCL')`,
    [cancelLine, cancelOrder, cancelIntentLine, cancelQuoteLine, cancelReqLine, partner, unitId],
  );

  // F approved BOQ demand
  const engReq = id();
  const engVer = id();
  const engLine = id();
  await owner.query(
    `INSERT INTO engineering_requests(id,company_id,created_by,title,sector,status,submitted_at)
     VALUES ($1,$2,$3,'Eng BOQ','HVAC','APPROVED',now())`,
    [engReq, partner, partnerUser],
  );
  await owner.query(
    `INSERT INTO engineering_boq_versions(id,request_id,company_id,version_number,status,created_by,approved_by,approved_at)
     VALUES ($1,$2,$3,1,'APPROVED',$4,$4,now()-interval '2 days')`,
    [engVer, engReq, partner, scoActor],
  );
  await owner.query(
    `UPDATE engineering_requests SET current_approved_boq_version_id=$1 WHERE id=$2`,
    [engVer, engReq],
  );
  await owner.query(
    `INSERT INTO engineering_boq_lines(id,boq_version_id,request_id,company_id,line_key,description,specification,discipline,quantity,unit_id,brand_preference,model_preference,sort_order)
     VALUES ($1,$2,$3,$4,'E1','AHU-01','50 TR','HVAC',3,$5,'Carrier','X',1)`,
    [engLine, engVer, engReq, partner, unitId],
  );

  // Verify noise — must never be ingested
  await owner.query(
    `INSERT INTO verify_requests(id,company_id,requested_by,status) VALUES ($1,$2,$3,'DRAFT')`,
    [id(), partner, partnerUser],
  );

  comparableKey = (
    await owner.query(`SELECT public.g_comparable_key('HVAC','AHU-01','50 TR','Carrier','X',$1::uuid) AS k`, [unitId])
  ).rows[0].k;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication(new FastifyAdapter());
  app.useGlobalPipes(new ApiValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

describe('G procurement intelligence', () => {
  it('backfill, aggregates, security, verify exclusion, source non-mutation', async () => {
    const scoCookie = await login(scoActor);
    const partnerCookie = await login(partnerUser);

    const quoteSnap = await owner.query(`SELECT unit_price::text FROM procurement_requirement_quote_lines WHERE id=$1`, [quoteLineId]);
    const poSnap = await owner.query(`SELECT status, purchase_total::text FROM commercial_supplier_orders WHERE id=$1`, [orderId]);
    const engSnap = await owner.query(`SELECT status FROM engineering_boq_versions WHERE request_id IN (SELECT id FROM engineering_requests WHERE company_id=$1)`, [partner]);

    // Partner denied
    const partnerDenied = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/g-intelligence/price-history',
      headers: { cookie: partnerCookie, 'x-sco-company-id': partner },
    });
    expect(partnerDenied.statusCode).toBe(403);

    // Dry-run
    const dry = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/g-intelligence/backfill',
          headers: { cookie: scoCookie },
          payload: { dryRun: true },
        })
      ).body,
    );
    expect(dry.dryRun).toBe(true);
    expect(dry.metricVersion).toBe(1);

    // Backfill
    const fill1 = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/g-intelligence/backfill',
          headers: { cookie: scoCookie },
          payload: { dryRun: false },
        })
      ).body,
    );
    expect(fill1.inserted).toBeGreaterThan(0);
    expect(fill1.verifyIngested).toBe(false);

    // Idempotent replay
    const fill2 = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/internal/g-intelligence/backfill',
          headers: { cookie: scoCookie },
          payload: {},
        })
      ).body,
    );
    expect(fill2.inserted).toBe(0);
    expect(fill2.updated).toBeGreaterThan(0);

    // Concurrent backfill conflict (advisory lock) — sequential still fine; second completed
    expect(fill2.runId).toBeTruthy();

    // Verify exclusion
    const verifyFacts = await owner.query(`SELECT COUNT(*)::int AS n FROM g_procurement_facts WHERE source_domain='VERIFY' OR source_entity_type ILIKE '%verify%'`);
    expect(verifyFacts.rows[0].n).toBe(0);
    const verifyInSql = await owner.query(
      `SELECT COUNT(*)::int AS n FROM pg_proc WHERE proname LIKE 'internal_g%' AND pg_get_functiondef(oid) ILIKE '%verify_quote%'`,
    );
    expect(verifyInSql.rows[0].n).toBe(0);

    // Source non-mutation
    const quoteAfter = await owner.query(`SELECT unit_price::text FROM procurement_requirement_quote_lines WHERE id=$1`, [quoteLineId]);
    const poAfter = await owner.query(`SELECT status, purchase_total::text FROM commercial_supplier_orders WHERE id=$1`, [orderId]);
    expect(quoteAfter.rows[0]).toEqual(quoteSnap.rows[0]);
    expect(poAfter.rows[0]).toEqual(poSnap.rows[0]);
    expect((await owner.query(`SELECT COUNT(*)::int AS n FROM engineering_boq_versions WHERE status='APPROVED'`)).rows[0].n).toBeGreaterThan(0);
    expect(engSnap.rows.length).toBeGreaterThan(0);

    // Price history
    const history = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/internal/g-intelligence/price-history?comparableKey=${comparableKey}&currencyCode=SAR&unitId=${unitId}&sector=HVAC`,
          headers: { cookie: scoCookie },
        })
      ).body,
    );
    expect(history.quotedHistory.sampleCount).toBeGreaterThanOrEqual(3);
    expect(Number(history.quotedHistory.min)).toBe(50);
    expect(Number(history.quotedHistory.max)).toBe(200);
    expect(history.quotedHistory.median).toBeTruthy();
    expect(history.confirmedPurchaseHistory.sampleCount).toBeGreaterThanOrEqual(1);
    expect(Number(history.confirmedPurchaseHistory.latest)).toBe(110);
    expect(history.metricVersion).toBe(1);
    expect(history.calculatedAt).toBeTruthy();

    // Median odd/even via SQL helper
    const medOdd = await owner.query(`SELECT public.g_numeric_median(ARRAY[1,3,2]::numeric[]) AS m`);
    expect(Number(medOdd.rows[0].m)).toBe(2);
    const medEven = await owner.query(`SELECT public.g_numeric_median(ARRAY[1,2,3,4]::numeric[]) AS m`);
    expect(Number(medEven.rows[0].m)).toBe(2.5);

    // Currency isolation
    const usdHist = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/internal/g-intelligence/price-history?comparableKey=${comparableKey}&currencyCode=USD&unitId=${unitId}`,
          headers: { cookie: scoCookie },
        })
      ).body,
    );
    expect(usdHist.quotedHistory.sampleCount ?? 0).toBe(0);

    // Unit isolation — insert meter fact shouldn't mix (no meter quotes in seed)
    const unitHist = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/internal/g-intelligence/price-history?comparableKey=${comparableKey}&currencyCode=SAR&unitId=${unitOther}`,
          headers: { cookie: scoCookie },
        })
      ).body,
    );
    expect(unitHist.quotedHistory.sampleCount ?? 0).toBe(0);

    // Benchmarks
    const within = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/internal/g-intelligence/quotes/${quoteLineId}/benchmark`, headers: { cookie: scoCookie } })).body,
    );
    expect(['WITHIN_HISTORICAL_RANGE', 'ABOVE_HISTORICAL_RANGE', 'BELOW_HISTORICAL_RANGE']).toContain(within.signal);
    expect(within.sampleCount).toBeGreaterThan(0);
    expect(JSON.stringify(within)).not.toMatch(/BUY|REJECT|CHOOSE_SUPPLIER/);

    const above = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/internal/g-intelligence/quotes/${quoteLineHighId}/benchmark`, headers: { cookie: scoCookie } })).body,
    );
    expect(above.signal).toBe('ABOVE_HISTORICAL_RANGE');

    const below = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/internal/g-intelligence/quotes/${quoteLineLowId}/benchmark`, headers: { cookie: scoCookie } })).body,
    );
    expect(below.signal).toBe('BELOW_HISTORICAL_RANGE');

    // Supplier performance
    const perf = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/internal/g-intelligence/suppliers/${supplier}/performance`,
          headers: { cookie: scoCookie },
        })
      ).body,
    );
    expect(perf.poCount).toBeGreaterThanOrEqual(2);
    expect(perf.confirmedPoCount).toBeGreaterThanOrEqual(1);
    expect(perf.cancellationCount).toBeGreaterThanOrEqual(1);
    expect(perf.confirmationLatencySecondsMean).toBeGreaterThan(0);
    expect(perf.deliveryMetrics).toBeNull();
    expect(perf.cancellationRateDenominator).toBe('issued_po_count_including_cancelled');

    // Category
    const cat = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/internal/g-intelligence/categories/HVAC', headers: { cookie: scoCookie } })).body,
    );
    expect(cat.quoteActivity).toBeGreaterThan(0);
    expect(cat.purchaseActivity).toBeGreaterThan(0);
    expect(cat.supplierCount).toBeGreaterThan(0);
    expect(cat.demandActivity30d).toBeGreaterThan(0);

    // Demand — no forecast semantics
    const demand = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/internal/g-intelligence/demand?sector=HVAC&windowDays=90', headers: { cookie: scoCookie } })).body,
    );
    expect(demand.semantics).toBe('observed_operational_demand_only');
    expect(demand.semantics.includes('forecast')).toBe(false);
    expect(demand.openDemand.length).toBeGreaterThan(0);
    expect(demand.recentEngineeringDemand.length).toBeGreaterThan(0);

    // Decision support
    const ds = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/internal/g-intelligence/decision-support/quotes/${quoteLineId}`,
          headers: { cookie: scoCookie },
        })
      ).body,
    );
    expect(ds.actionExecution).toBe(false);
    expect(ds.benchmark).toBeTruthy();
    expect(ds.priceHistory).toBeTruthy();

    // Evidence pagination
    const evidence = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/internal/g-intelligence/evidence?comparableKey=${comparableKey}&limit=2&offset=0`,
          headers: { cookie: scoCookie },
        })
      ).body,
    );
    expect(evidence.items.length).toBeLessThanOrEqual(2);
    expect(evidence.total).toBeGreaterThan(2);

    // Partner cannot hit supplier/cost endpoints
    for (const url of [
      `/api/v1/internal/g-intelligence/suppliers/${supplier}/performance`,
      `/api/v1/internal/g-intelligence/quotes/${quoteLineId}/benchmark`,
      `/api/v1/internal/g-intelligence/decision-support/quotes/${quoteLineId}`,
    ]) {
      const denied = await app.inject({ method: 'GET', url, headers: { cookie: partnerCookie, 'x-sco-company-id': partner } });
      expect(denied.statusCode).toBe(403);
    }

    // No margin fields in G responses
    expect(JSON.stringify({ history, within, perf, ds })).not.toMatch(/grossMargin|partnerMargin|sale_unit_price/);
  });
});
