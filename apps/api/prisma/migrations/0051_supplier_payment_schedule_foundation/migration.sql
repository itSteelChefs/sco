ALTER TABLE supplier_purchase_orders ADD COLUMN payment_terms_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE supplier_purchase_orders ADD COLUMN original_supplier_terms_text TEXT;

CREATE OR REPLACE FUNCTION public.snapshot_supplier_po_payment_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_terms jsonb; v_text text; v_count integer;
BEGIN
  IF NEW.status='ISSUED' AND OLD.status<>'ISSUED' THEN
    SELECT count(DISTINCT jsonb_build_object('paymentTerms',s.payment_terms,'originalTermsText',q.original_terms_text)::text),
           (array_agg(jsonb_build_object('paymentTerms',s.payment_terms,'originalTermsText',q.original_terms_text) ORDER BY s.created_at))[1],
           (array_agg(q.original_terms_text ORDER BY s.created_at))[1]
      INTO v_count,v_terms,v_text
      FROM supplier_purchase_order_lines l
      JOIN supplier_po_release_line_allocations a ON a.supplier_purchase_order_line_id=l.id
      JOIN approved_purchase_cost_snapshots s ON s.id=a.approved_purchase_cost_snapshot_id
      JOIN supplier_quote_revisions q ON q.id=s.supplier_quote_revision_id
     WHERE l.supplier_purchase_order_id=NEW.id;
    IF COALESCE(v_count,0)>1 THEN RAISE EXCEPTION 'SUPPLIER_PO_PAYMENT_TERMS_CONFLICT'; END IF;
    NEW.payment_terms_snapshot:=COALESCE(v_terms,'{}'::jsonb);
    NEW.original_supplier_terms_text:=v_text;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_po_payment_terms_snapshot BEFORE UPDATE OF status ON supplier_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.snapshot_supplier_po_payment_terms();

CREATE TYPE "SupplierPaymentScheduleStatus" AS ENUM ('DRAFT','APPROVED','SUPERSEDED');
CREATE TABLE supplier_payment_schedule_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), supplier_purchase_order_id UUID NOT NULL REFERENCES supplier_purchase_orders(id), revision_number INTEGER NOT NULL CHECK(revision_number>0), status "SupplierPaymentScheduleStatus" NOT NULL DEFAULT 'DRAFT', currency_code TEXT NOT NULL, payable_basis_amount NUMERIC(18,6) NOT NULL CHECK(payable_basis_amount>=0), basis_type TEXT NOT NULL CHECK(basis_type='ISSUED_PO_ACTUAL_COST'), payment_terms_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, original_supplier_terms_text TEXT, created_by UUID NOT NULL REFERENCES "User"(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), approved_by UUID REFERENCES "User"(id), approved_at TIMESTAMPTZ, supersedes_revision_id UUID REFERENCES supplier_payment_schedule_revisions(id), correlation_id UUID, UNIQUE(supplier_purchase_order_id,revision_number)
);
CREATE TABLE supplier_payment_schedule_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), schedule_revision_id UUID NOT NULL REFERENCES supplier_payment_schedule_revisions(id) ON DELETE RESTRICT, line_number INTEGER NOT NULL CHECK(line_number>0), trigger_type TEXT NOT NULL CHECK(trigger_type IN ('PO_ISSUANCE','ADVANCE','SUPPLIER_CONFIRMATION','BEFORE_DELIVERY','DELIVERY','FIXED_DATE','CONTRACTUAL_MILESTONE')), amount NUMERIC(18,6) NOT NULL CHECK(amount>=0), percentage NUMERIC(9,6) CHECK(percentage IS NULL OR (percentage>=0 AND percentage<=100)), fixed_date DATE, milestone_description TEXT, trigger_reference_metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_by UUID NOT NULL REFERENCES "User"(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(schedule_revision_id,line_number), CHECK((trigger_type='FIXED_DATE') = (fixed_date IS NOT NULL)), CHECK((trigger_type='CONTRACTUAL_MILESTONE') = (milestone_description IS NOT NULL AND btrim(milestone_description)<>''))
);
ALTER TABLE supplier_payment_schedule_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE supplier_payment_schedule_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_schedule_items ENABLE ROW LEVEL SECURITY; ALTER TABLE supplier_payment_schedule_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON supplier_payment_schedule_revisions,supplier_payment_schedule_items FROM sco_runtime,sco_internal_executor;
INSERT INTO "Permission"(id,code,description) VALUES (gen_random_uuid(),'supplier_po.payment_schedule.read_all','Read all supplier payment schedules'),(gen_random_uuid(),'supplier_po.payment_schedule.read_assigned','Read assigned supplier payment schedules'),(gen_random_uuid(),'supplier_po.payment_schedule.draft.manage','Manage supplier payment schedule drafts'),(gen_random_uuid(),'supplier_po.payment_schedule.approve','Approve supplier payment schedules'),(gen_random_uuid(),'supplier_po.payment_schedule.revise','Revise supplier payment schedules') ON CONFLICT(code) DO NOTHING;
