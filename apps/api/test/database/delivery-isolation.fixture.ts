import { randomUUID } from 'node:crypto';
import type { Client, Pool } from 'pg';

type Queryable = Pool | Client;

export interface DeliverySourceFixture {
  partnerCompanyId: string;
  supplierCompanyId: string;
  purchaseSourceId: string;
  commitmentId: string;
  commitmentLineId: string;
  productIdentityId: string;
  unitId: string;
  approvedPurchaseCostSnapshotId: string;
  currencyCode: string;
  unitPurchaseCost: number;
  categoryId: string;
}

const id = () => randomUUID();

export async function createDeliveryIsolationSources(owner: Queryable): Promise<[DeliverySourceFixture, DeliverySourceFixture]> {
  const creator = id();
  const supplierCompanyId = id();
  const partnerCompanyIds = [id(), id()];
  const categoryIds = [id(), id()];
  const unitId = id();
  const productIdentityIds = [id(), id()];
  const supplierPartnershipId = id();
  const purchaseSourceIds = [id(), id()];
  const sourceTypeId = (await owner.query<{ id: string }>('SELECT id FROM purchase_source_type_definitions ORDER BY id LIMIT 1')).rows[0]?.id;
  if (!sourceTypeId) throw new Error('DELIVERY_ISOLATION_PURCHASE_SOURCE_TYPE_REQUIRED');

  await owner.query('INSERT INTO "User"(id,email,"passwordHash") VALUES($1,$2,\'x\')', [creator, `${creator}@delivery-isolation.test`]);
  await owner.query('INSERT INTO "Company"(id,name,type) VALUES($1,\'Delivery Isolation Partner A\',\'PARTNER\'),($2,\'Delivery Isolation Partner B\',\'PARTNER\'),($3,\'Delivery Isolation Supplier\',\'SUPPLIER\')', [partnerCompanyIds[0], partnerCompanyIds[1], supplierCompanyId]);
  await owner.query('INSERT INTO product_categories(id,code,name) VALUES($1,$3,\'Delivery Isolation A\'),($2,$4,\'Delivery Isolation B\')', [categoryIds[0], categoryIds[1], `delivery-${categoryIds[0]}`, `delivery-${categoryIds[1]}`]);
  await owner.query('INSERT INTO unit_definitions(id,code,name,dimension) VALUES($1,$2,\'Each\',\'count\')', [unitId, `delivery-${unitId}`]);
  await owner.query('INSERT INTO product_identities(id,category_id,unit_id,created_by,status) VALUES($1,$3,$5,$6,\'ACTIVE\'),($2,$4,$5,$6,\'ACTIVE\')', [productIdentityIds[0], productIdentityIds[1], categoryIds[0], categoryIds[1], unitId, creator]);
  await owner.query('INSERT INTO company_partnerships(id,company_id,type,status) VALUES($1,$2,\'SUPPLIER_PARTNERSHIP\',\'ACTIVE\')', [supplierPartnershipId, supplierCompanyId]);
  await owner.query('INSERT INTO supplier_qualifications(id,company_id,supplier_partnership_id,status,created_by) VALUES($1,$2,$3,\'ACTIVE\',$4)', [id(), supplierCompanyId, supplierPartnershipId, creator]);
  await owner.query('INSERT INTO supplier_category_capabilities(id,company_id,supplier_partnership_id,category_id,status) VALUES($1,$3,$4,$5,\'ACTIVE\'),($2,$3,$4,$6,\'ACTIVE\')', [id(), id(), supplierCompanyId, supplierPartnershipId, categoryIds[0], categoryIds[1]]);
  await owner.query('INSERT INTO purchase_sources(id,supplier_company_id,supplier_partnership_id,source_code,source_type_id,status,created_by) VALUES($1,$3,$4,$5,$6,\'ACTIVE\',$7),($2,$3,$4,$8,$6,\'ACTIVE\',$7)', [purchaseSourceIds[0], purchaseSourceIds[1], supplierCompanyId, supplierPartnershipId, `delivery-${purchaseSourceIds[0]}`, sourceTypeId, creator, `delivery-${purchaseSourceIds[1]}`]);

  const sources: DeliverySourceFixture[] = [];
  for (const [index, partnerCompanyId] of partnerCompanyIds.entries()) {
    const purchaseSourceId = purchaseSourceIds[index];
    const categoryId = categoryIds[index];
    const productIdentityId = productIdentityIds[index];
    const projectId = id();
    const needId = id();
    const cycleId = id();
    const executionId = id();
    const executionItemId = id();
    const rfqId = id();
    const rfqItemId = id();
    const quoteId = id();
    const quoteRevisionId = id();
    const approvedPurchaseCostSnapshotId = id();
    const offerId = id();
    const offerRevisionId = id();
    const partnerPurchaseOrderId = id();
    const commitmentId = id();
    const commitmentLineId = id();

    await owner.query('INSERT INTO projects(id,company_id,code,name,status,created_by) VALUES($1,$2,$3,\'Delivery Isolation\',\'ACTIVE\',$4)', [projectId, partnerCompanyId, `delivery-${index}-${projectId}`, creator]);
    await owner.query('INSERT INTO procurement_needs(id,company_id,project_id,created_by,source_type,product_identity_id,description,quantity,unit_id,need_date,maturity,review_status) VALUES($1,$2,$3,$4,\'MANUAL\',$5,\'Delivery isolation need\',100,$6,current_date,\'READY\',\'APPROVED\')', [needId, partnerCompanyId, projectId, creator, productIdentityId, unitId]);
    await owner.query('INSERT INTO procurement_cycles(id,cycle_code,name,intake_opens_at,intake_closes_at,status) VALUES($1,$2,\'Delivery Isolation\',now(),now(),\'PROCESSING\')', [cycleId, `delivery-${index}-${cycleId}`]);
    await owner.query('INSERT INTO procurement_executions(id,cycle_id,status,created_by) VALUES($1,$2,\'SOURCING_READY\',$3)', [executionId, cycleId, creator]);
    await owner.query('INSERT INTO procurement_execution_items(id,execution_id,company_id,project_id,procurement_need_id,product_identity_id,allocated_quantity,remaining_quantity,unit_id,need_date,idempotency_key,created_by,status) VALUES($1,$2,$3,$4,$5,$6,100,100,$7,current_date,$8,$9,\'SOURCING_READY\')', [executionItemId, executionId, partnerCompanyId, projectId, needId, productIdentityId, unitId, id(), creator]);
    await owner.query('INSERT INTO rfqs(id,created_by,status) VALUES($1,$2,\'EVALUATION\')', [rfqId, creator]);
    await owner.query('INSERT INTO rfq_items(id,rfq_id,execution_item_id,company_id,project_id,procurement_need_id,product_identity_id,requested_quantity,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,100,$8)', [rfqItemId, rfqId, executionItemId, partnerCompanyId, projectId, needId, productIdentityId, unitId]);
    await owner.query('INSERT INTO supplier_quotes(id,rfq_id,purchase_source_id,supplier_company_id,created_by) VALUES($1,$2,$3,$4,$5)', [quoteId, rfqId, purchaseSourceId, supplierCompanyId, creator]);
    await owner.query('INSERT INTO supplier_quote_revisions(id,supplier_quote_id,revision_number,initiated_by,currency_code,valid_until) VALUES($1,$2,1,$3,\'SAR\',\'2099-12-31\')', [quoteRevisionId, quoteId, creator]);
    await owner.query('INSERT INTO approved_purchase_cost_snapshots(id,rfq_item_id,supplier_quote_revision_id,purchase_source_id,supplier_company_id,product_identity_id,approved_quantity,currency_code,unit_purchase_cost,amount_excl_tax,amount_incl_tax,status,approved_by,approved_at,approval_reason,created_by) VALUES($1,$2,$3,$4,$5,$6,100,\'SAR\',1,100,100,\'APPROVED\',$7,now(),\'delivery isolation\',$7)', [approvedPurchaseCostSnapshotId, rfqItemId, quoteRevisionId, purchaseSourceId, supplierCompanyId, productIdentityId, creator]);
    await owner.query('INSERT INTO partner_offers(id,company_id,offer_reference,created_by) VALUES($1,$2,$3,$4)', [offerId, partnerCompanyId, `delivery-${index}-${offerId}`, creator]);
    await owner.query('INSERT INTO partner_offer_revisions(id,partner_offer_id,revision_number,status,currency_code,offer_total_excl_tax,offer_tax_amount,offer_total_incl_tax,created_by) VALUES($1,$2,1,\'ACCEPTED\',\'SAR\',100,0,100,$3)', [offerRevisionId, offerId, creator]);
    await owner.query('INSERT INTO partner_purchase_orders(id,partner_company_id,accepted_offer_id,accepted_offer_revision_id,po_reference,po_date,submitted_by,currency_code,total_excl_tax,total_incl_tax,status) VALUES($1,$2,$3,$4,$5,current_date,$6,\'SAR\',100,100,\'VERIFIED\')', [partnerPurchaseOrderId, partnerCompanyId, offerId, offerRevisionId, `delivery-${index}-${partnerPurchaseOrderId}`, creator]);
    await owner.query('INSERT INTO commercial_commitments(id,partner_company_id,partner_purchase_order_id,accepted_offer_id,accepted_offer_revision_id,commitment_revision_number,currency_code,total_excl_tax,total_incl_tax,committed_by) VALUES($1,$2,$3,$4,$5,1,\'SAR\',100,100,$6)', [commitmentId, partnerCompanyId, partnerPurchaseOrderId, offerId, offerRevisionId, creator]);
    await owner.query('INSERT INTO commercial_commitment_lines(id,commercial_commitment_id,line_number,product_identity_id,product_description,quantity,unit_id,unit_selling_price,amount_excl_tax,amount_incl_tax) VALUES($1,$2,1,$3,\'Delivery isolation item\',100,$4,1,100,100)', [commitmentLineId, commitmentId, productIdentityId, unitId]);

    sources.push({
      partnerCompanyId,
      supplierCompanyId,
      purchaseSourceId,
      commitmentId,
      commitmentLineId,
      productIdentityId,
      unitId,
      approvedPurchaseCostSnapshotId,
      currencyCode: 'SAR',
      unitPurchaseCost: 1,
      categoryId,
    });
  }

  return [sources[0], sources[1]];
}
