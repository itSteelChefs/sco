DO $$
DECLARE
  definition text;
  needle text := 'COALESCE((SELECT sum(a.converted_quantity) FROM commitment_demand_conversion_allocations a WHERE a.source_type=''NEED'' AND a.source_id=n.id),0) AS direct_committed';
  replacement text := 'COALESCE((SELECT sum(a.converted_quantity) FROM commitment_demand_conversion_allocations a WHERE a.source_type=''NEED'' AND a.source_id=n.id),0) AS direct_committed,
           COALESCE((SELECT sum(rl.released_quantity)
                       FROM procurement_release_lines rl
                      WHERE EXISTS (
                        SELECT 1
                          FROM commitment_demand_conversion_allocations ca
                          LEFT JOIN procurement_execution_items ei ON ca.source_type=''EXECUTION_ITEM'' AND ei.id=ca.source_id
                         WHERE ca.commitment_line_id=rl.commercial_commitment_line_id
                           AND ((ca.source_type=''NEED'' AND ca.source_id=n.id) OR (ca.source_type=''EXECUTION_ITEM'' AND ei.procurement_need_id=n.id))
                      )
                        AND EXISTS (SELECT 1 FROM procurement_releases pr WHERE pr.id=rl.release_id AND pr.status=''PROCUREMENT_RELEASED'')
                     ),0) AS released_quantity,
           COALESCE((SELECT sum(LEAST(rl.released_quantity,COALESCE((SELECT sum(pa.allocated_quantity)
                       FROM supplier_po_release_line_allocations pa
                       JOIN supplier_purchase_order_lines pl ON pl.id=pa.supplier_purchase_order_line_id
                       JOIN supplier_purchase_orders po ON po.id=pl.supplier_purchase_order_id
                      WHERE pa.procurement_release_line_id=rl.id AND po.status=''ISSUED''),0)))
                       FROM procurement_release_lines rl
                      WHERE EXISTS (
                        SELECT 1
                          FROM commitment_demand_conversion_allocations ca
                          LEFT JOIN procurement_execution_items ei ON ca.source_type=''EXECUTION_ITEM'' AND ei.id=ca.source_id
                         WHERE ca.commitment_line_id=rl.commercial_commitment_line_id
                           AND ((ca.source_type=''NEED'' AND ca.source_id=n.id) OR (ca.source_type=''EXECUTION_ITEM'' AND ei.procurement_need_id=n.id))
                      )
                        AND EXISTS (SELECT 1 FROM procurement_releases pr WHERE pr.id=rl.release_id AND pr.status=''PROCUREMENT_RELEASED'')
                     ),0) AS procured_quantity';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO definition
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND p.proname='internal_buying_power_classified_run'
     AND pg_get_function_identity_arguments(p.oid)='p_actor uuid, p_horizon text, p_bucket date, p_request_key text, p_need_ids uuid[], p_line_ids uuid[], p_correlation text';
  IF definition IS NULL OR strpos(definition, needle)=0 THEN
    RAISE EXCEPTION 'BUYING_POWER_RELEASE_METRIC_ROOT_DEFINITION_UNEXPECTED';
  END IF;
  definition := substr(definition,1,strpos(definition,needle)-1)
             || replacement
             || substr(definition,strpos(definition,needle)+length(needle));
  EXECUTE definition;
END $$;
