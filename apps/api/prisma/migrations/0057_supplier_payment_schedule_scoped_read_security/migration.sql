CREATE OR REPLACE FUNCTION public.internal_supplier_payment_schedule_can_read(p_actor uuid,p_po uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.internal_has_capability(p_actor,'supplier_po.payment_schedule.read_all')
 OR (
   public.internal_has_capability(p_actor,'supplier_po.payment_schedule.read_assigned')
   AND EXISTS (SELECT 1 FROM supplier_purchase_orders p WHERE p.id=p_po)
   AND NOT EXISTS (
     SELECT 1
     FROM supplier_purchase_order_lines l
     JOIN product_identities pi ON pi.id=l.product_identity_id
     JOIN supplier_purchase_orders p ON p.id=l.supplier_purchase_order_id
     WHERE l.supplier_purchase_order_id=p_po
       AND NOT (
         EXISTS (SELECT 1 FROM procurement_engineer_scope_assignments s WHERE s.actor_user_id=p_actor AND s.purchase_source_id=p.purchase_source_id AND s.product_category_id=pi.category_id AND s.status='ACTIVE')
         OR EXISTS (SELECT 1 FROM supplier_po_line_responsibilities r WHERE r.supplier_purchase_order_line_id=l.id AND r.actor_user_id=p_actor)
       )
   )
 );
$$;

DROP FUNCTION public.internal_supplier_payment_schedule_get(uuid,uuid);

CREATE FUNCTION public.internal_supplier_payment_schedule_get(p_actor uuid,p_revision uuid)
RETURNS TABLE(id uuid,supplier_purchase_order_id uuid,revision_number integer,status "SupplierPaymentScheduleStatus",currency_code text,payable_basis_amount numeric,basis_type text,payment_terms_snapshot jsonb,original_supplier_terms_text text,created_by uuid,created_at timestamptz,approved_by uuid,approved_at timestamptz,supersedes_revision_id uuid,correlation_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT r.id,r.supplier_purchase_order_id,r.revision_number,r.status,r.currency_code,r.payable_basis_amount,r.basis_type,r.payment_terms_snapshot,r.original_supplier_terms_text,r.created_by,r.created_at,r.approved_by,r.approved_at,r.supersedes_revision_id,r.correlation_id
 FROM supplier_payment_schedule_revisions r
 WHERE r.id=p_revision AND public.internal_supplier_payment_schedule_can_read(p_actor,r.supplier_purchase_order_id);
$$;

CREATE OR REPLACE FUNCTION public.internal_supplier_payment_schedule_items_get(p_actor uuid,p_revision uuid)
RETURNS TABLE(id uuid,line_number integer,trigger_type text,amount numeric,percentage numeric,fixed_date date,milestone_description text,created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT i.id,i.line_number,i.trigger_type,i.amount,i.percentage,i.fixed_date,i.milestone_description,i.created_at
 FROM supplier_payment_schedule_items i
 JOIN supplier_payment_schedule_revisions r ON r.id=i.schedule_revision_id
 WHERE r.id=p_revision AND public.internal_supplier_payment_schedule_can_read(p_actor,r.supplier_purchase_order_id)
 ORDER BY i.line_number;
$$;

REVOKE ALL ON FUNCTION public.internal_supplier_payment_schedule_can_read(uuid,uuid),public.internal_supplier_payment_schedule_get(uuid,uuid),public.internal_supplier_payment_schedule_items_get(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_payment_schedule_get(uuid,uuid),public.internal_supplier_payment_schedule_items_get(uuid,uuid) TO sco_internal_executor;
