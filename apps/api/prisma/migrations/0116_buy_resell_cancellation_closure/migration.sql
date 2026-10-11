-- E cancellation is permitted only before external supplier commitment. Records
-- remain immutable history; cancellation never deletes commercial evidence.
CREATE FUNCTION public.internal_commercial_purchase_cancel(p_actor UUID, p_intent UUID, p_reason TEXT, p_correlation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_company UUID;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.purchase.manage') OR btrim(COALESCE(p_reason,''))='' THEN RAISE EXCEPTION 'COMMERCIAL_PURCHASE_CANCEL_FORBIDDEN'; END IF;
  UPDATE public.commercial_purchase_intents SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=p_intent AND status='DRAFT' RETURNING partner_company_id INTO v_company;
  IF v_company IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_INTENT_NOT_CANCELLABLE'; END IF;
  INSERT INTO public.audit_logs(actor_user_id,company_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,v_company,'SCO_INTERNAL','commercial.purchase.intent_cancelled','CommercialPurchaseIntent',p_intent,jsonb_build_object('reason',p_reason),p_correlation);
  RETURN p_intent;
END $$;
CREATE FUNCTION public.internal_commercial_supplier_order_cancel(p_actor UUID, p_order UUID, p_reason TEXT, p_correlation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_company UUID;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.purchase.manage') OR btrim(COALESCE(p_reason,''))='' THEN RAISE EXCEPTION 'COMMERCIAL_ORDER_CANCEL_FORBIDDEN'; END IF;
  UPDATE public.commercial_supplier_orders SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=p_order AND status IN ('DRAFT','APPROVED') AND NOT EXISTS(SELECT 1 FROM public.commercial_partner_allocations a WHERE a.supplier_order_id=p_order AND a.status<>'CANCELLED') RETURNING sco_buyer_company_id INTO v_company;
  IF v_company IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_ORDER_NOT_CANCELLABLE'; END IF;
  INSERT INTO public.audit_logs(actor_user_id,company_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,v_company,'SCO_INTERNAL','commercial.supplier_order.cancelled','CommercialSupplierOrder',p_order,jsonb_build_object('reason',p_reason),p_correlation);
  RETURN p_order;
END $$;
CREATE FUNCTION public.internal_commercial_resale_cancel(p_actor UUID, p_order UUID, p_reason TEXT, p_correlation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_company UUID;
BEGIN
  IF NOT public.internal_commercial_capability(p_actor, 'commercial.resale.manage') OR btrim(COALESCE(p_reason,''))='' THEN RAISE EXCEPTION 'COMMERCIAL_RESALE_CANCEL_FORBIDDEN'; END IF;
  SELECT partner_company_id INTO v_company FROM public.commercial_partner_resale_orders WHERE id=p_order AND status='DRAFT' FOR UPDATE;
  IF v_company IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_RESALE_NOT_CANCELLABLE'; END IF;
  UPDATE public.commercial_partner_allocations a SET status='ACTIVE',resale_order_line_id=NULL WHERE a.resale_order_line_id IN (SELECT id FROM public.commercial_partner_resale_order_lines WHERE resale_order_id=p_order);
  UPDATE public.commercial_partner_resale_orders SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=p_order;
  INSERT INTO public.audit_logs(actor_user_id,company_id,scope,action,entity_type,entity_id,metadata,correlation_id) VALUES(p_actor,v_company,'SCO_INTERNAL','commercial.resale.cancelled','CommercialPartnerResaleOrder',p_order,jsonb_build_object('reason',p_reason),p_correlation);
  RETURN p_order;
END $$;
ALTER FUNCTION public.internal_commercial_purchase_cancel(UUID,UUID,TEXT,UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_supplier_order_cancel(UUID,UUID,TEXT,UUID) OWNER TO sco_internal_gateway_owner;
ALTER FUNCTION public.internal_commercial_resale_cancel(UUID,UUID,TEXT,UUID) OWNER TO sco_internal_gateway_owner;
REVOKE ALL ON FUNCTION public.internal_commercial_purchase_cancel(UUID,UUID,TEXT,UUID),public.internal_commercial_supplier_order_cancel(UUID,UUID,TEXT,UUID),public.internal_commercial_resale_cancel(UUID,UUID,TEXT,UUID) FROM PUBLIC,sco_runtime;
GRANT EXECUTE ON FUNCTION public.internal_commercial_purchase_cancel(UUID,UUID,TEXT,UUID),public.internal_commercial_supplier_order_cancel(UUID,UUID,TEXT,UUID),public.internal_commercial_resale_cancel(UUID,UUID,TEXT,UUID) TO sco_internal_executor;
