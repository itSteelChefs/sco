-- ApprovedPurchaseCostSnapshot is the explicit, immutable source-selection record.
-- Selection and its audit evidence are persisted atomically through this fixed gateway.

CREATE OR REPLACE FUNCTION public.internal_purchase_cost_approve(
  p_actor uuid,
  p_item uuid,
  p_revision uuid,
  p_source uuid,
  p_supplier uuid,
  p_product uuid,
  p_quantity numeric,
  p_currency text,
  p_unit_cost numeric,
  p_reason text,
  p_self boolean,
  p_correlation text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_creator uuid;
  v_valid date;
  v_source uuid;
  v_supplier uuid;
  v_product uuid;
  v_id uuid := gen_random_uuid();
BEGIN
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'APPROVAL_REASON_REQUIRED';
  END IF;

  IF NOT public.internal_has_capability(p_actor, 'source.select') THEN
    RAISE EXCEPTION 'SOURCE_SELECTION_FORBIDDEN';
  END IF;

  IF NOT public.internal_has_capability(p_actor, 'purchase_cost.approve') THEN
    RAISE EXCEPTION 'PURCHASE_COST_APPROVAL_FORBIDDEN';
  END IF;

  SELECT revision.initiated_by,
         revision.valid_until,
         quote.purchase_source_id,
         quote.supplier_company_id,
         quote_item.product_identity_id
    INTO v_creator, v_valid, v_source, v_supplier, v_product
    FROM public.supplier_quote_revisions revision
    JOIN public.supplier_quotes quote
      ON quote.id = revision.supplier_quote_id
    JOIN public.supplier_quote_items quote_item
      ON quote_item.revision_id = revision.id
     AND quote_item.rfq_item_id = p_item
   WHERE revision.id = p_revision;

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'REVISION_ITEM_NOT_FOUND';
  END IF;

  IF v_source <> p_source OR v_supplier <> p_supplier OR v_product <> p_product THEN
    RAISE EXCEPTION 'PURCHASE_COST_SELECTION_CONTEXT_MISMATCH';
  END IF;

  IF v_valid IS NOT NULL AND v_valid < current_date THEN
    RAISE EXCEPTION 'QUOTE_REVISION_EXPIRED';
  END IF;

  IF v_creator = p_actor AND
     (NOT p_self OR NOT public.internal_has_capability(p_actor, 'purchase_cost.self_approve')) THEN
    RAISE EXCEPTION 'SEPARATION_OF_DUTIES_REQUIRED';
  END IF;

  INSERT INTO public.approved_purchase_cost_snapshots(
    id, rfq_item_id, supplier_quote_revision_id, purchase_source_id,
    supplier_company_id, product_identity_id, approved_quantity,
    currency_code, unit_purchase_cost, amount_excl_tax, amount_incl_tax,
    status, approved_by, approved_at, approval_reason, correlation_id, created_by
  ) VALUES (
    v_id, p_item, p_revision, p_source, p_supplier, p_product, p_quantity,
    p_currency, p_unit_cost, p_quantity * p_unit_cost, p_quantity * p_unit_cost,
    'APPROVED', p_actor, now(), p_reason, p_correlation, p_actor
  );

  INSERT INTO public.audit_logs(
    actor_user_id, scope, action, entity_type, entity_id, metadata, correlation_id
  ) VALUES (
    p_actor,
    'SCO_INTERNAL',
    CASE WHEN p_self THEN 'purchase_cost.self_approved' ELSE 'purchase_cost.approved' END,
    'ApprovedPurchaseCostSnapshot',
    v_id,
    jsonb_build_object(
      'sourceSelection', true,
      'selfApproval', p_self,
      'purchaseSourceId', p_source,
      'rfqItemId', p_item,
      'supplierQuoteRevisionId', p_revision,
      'approvedQuantity', p_quantity,
      'reason', p_reason
    ),
    NULLIF(p_correlation, '')::uuid
  );

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.internal_purchase_cost_approve(
  uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, numeric, text, boolean, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.internal_purchase_cost_approve(
  uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, numeric, text, boolean, text
) TO sco_internal_executor;
