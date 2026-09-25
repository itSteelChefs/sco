CREATE OR REPLACE FUNCTION public.internal_buying_power_conversion_create(
  p_actor uuid,
  p_line uuid,
  p_source_type text,
  p_source uuid,
  p_quantity numeric,
  p_correlation text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_id uuid:=gen_random_uuid();
  v_line record;
  v_source record;
  v_used numeric;
  v_line_used numeric;
  v_reserved numeric;
BEGIN
  IF NOT public.internal_has_capability(p_actor,'buying_power.aggregate') THEN RAISE EXCEPTION 'BUYING_POWER_AGGREGATION_FORBIDDEN'; END IF;
  IF p_quantity IS NULL OR p_quantity<=0 OR p_source_type NOT IN ('NEED','EXECUTION_ITEM','EXTERNAL') THEN RAISE EXCEPTION 'BUYING_POWER_CONVERSION_INVALID'; END IF;
  SELECT cl.id,cl.product_identity_id,cl.unit_id,cl.quantity,cc.partner_company_id
    INTO v_line
    FROM commercial_commitment_lines cl
    JOIN commercial_commitments cc ON cc.id=cl.commercial_commitment_id
   WHERE cl.id=p_line
   FOR UPDATE;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'BUYING_POWER_CONVERSION_INVALID'; END IF;
  SELECT COALESCE(sum(converted_quantity),0) INTO v_line_used
    FROM commitment_demand_conversion_allocations
   WHERE commitment_line_id=p_line;
  IF v_line_used+p_quantity>v_line.quantity THEN RAISE EXCEPTION 'BUYING_POWER_CONVERSION_COMMITMENT_EXCEEDED'; END IF;
  IF p_source_type='EXTERNAL' THEN
    IF p_source IS NOT NULL THEN RAISE EXCEPTION 'BUYING_POWER_CONVERSION_INVALID'; END IF;
    PERFORM set_config('app.buying_power_gateway','true',true);
    INSERT INTO commitment_demand_conversion_allocations(id,commitment_line_id,source_type,source_company_id,converted_quantity,unit_id,created_by,correlation_id)
    VALUES(v_id,p_line,'EXTERNAL',v_line.partner_company_id,p_quantity,v_line.unit_id,p_actor,NULLIF(p_correlation,'')::uuid);
  ELSE
    IF p_source_type='NEED' THEN
      SELECT n.id,n.company_id,n.product_identity_id,n.unit_id,n.quantity AS available_quantity
        INTO v_source
        FROM procurement_needs n
       WHERE n.id=p_source
       FOR UPDATE;
      SELECT COALESCE(sum(e.allocated_quantity),0)
        INTO v_reserved
        FROM procurement_execution_items e
       WHERE e.procurement_need_id=p_source
         AND e.status NOT IN ('WITHDRAWN','CANCELLED');
      v_source.available_quantity:=GREATEST(v_source.available_quantity-v_reserved,0);
    ELSE
      SELECT e.id,e.company_id,e.product_identity_id,e.unit_id,e.allocated_quantity AS available_quantity
        INTO v_source
        FROM procurement_execution_items e
       WHERE e.id=p_source
       FOR UPDATE;
    END IF;
    IF v_source.id IS NULL THEN RAISE EXCEPTION 'BUYING_POWER_CONVERSION_INVALID'; END IF;
    IF v_source.company_id<>v_line.partner_company_id THEN RAISE EXCEPTION 'BUYING_POWER_CONVERSION_TENANT_MISMATCH'; END IF;
    IF v_source.product_identity_id<>v_line.product_identity_id THEN RAISE EXCEPTION 'BUYING_POWER_CONVERSION_PRODUCT_MISMATCH'; END IF;
    IF v_source.unit_id<>v_line.unit_id THEN RAISE EXCEPTION 'BUYING_POWER_CONVERSION_UNIT_MISMATCH'; END IF;
    SELECT COALESCE(sum(converted_quantity),0)
      INTO v_used
      FROM commitment_demand_conversion_allocations
     WHERE source_type=p_source_type::"BuyingPowerConversionSourceType"
       AND source_id=p_source;
    IF v_used+p_quantity>v_source.available_quantity THEN RAISE EXCEPTION 'BUYING_POWER_CONVERSION_SOURCE_EXCEEDED'; END IF;
    PERFORM set_config('app.buying_power_gateway','true',true);
    INSERT INTO commitment_demand_conversion_allocations(id,commitment_line_id,source_type,source_id,source_company_id,converted_quantity,unit_id,created_by,correlation_id)
    VALUES(v_id,p_line,p_source_type::"BuyingPowerConversionSourceType",p_source,v_source.company_id,p_quantity,v_source.unit_id,p_actor,NULLIF(p_correlation,'')::uuid);
  END IF;
  INSERT INTO audit_logs(actor_user_id,scope,action,entity_type,entity_id,metadata,correlation_id)
  VALUES(p_actor,'SCO_INTERNAL','buying_power.conversion.recorded','CommitmentDemandConversion',v_id,
         jsonb_build_object('commitmentLineId',p_line,'sourceType',p_source_type,'quantity',p_quantity),NULLIF(p_correlation,'')::uuid);
  RETURN v_id;
END $$;
