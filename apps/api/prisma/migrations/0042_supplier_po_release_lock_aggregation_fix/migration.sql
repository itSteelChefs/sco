DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$
  FOR v_release IN
    SELECT rl.id,rl.released_quantity
    FROM procurement_release_lines rl
    JOIN supplier_po_release_line_allocations pa ON pa.procurement_release_line_id=rl.id
    JOIN supplier_purchase_order_lines pl ON pl.id=pa.supplier_purchase_order_line_id
    WHERE pl.supplier_purchase_order_id=p_po
    GROUP BY rl.id,rl.released_quantity
    ORDER BY rl.id
    FOR UPDATE
  LOOP$old$;
  v_new text := $new$
  FOR v_release IN
    SELECT rl.id,rl.released_quantity
    FROM procurement_release_lines rl
    WHERE rl.id IN (
      SELECT DISTINCT pa.procurement_release_line_id
      FROM supplier_po_release_line_allocations pa
      JOIN supplier_purchase_order_lines pl ON pl.id=pa.supplier_purchase_order_line_id
      WHERE pl.supplier_purchase_order_id=p_po
    )
    ORDER BY rl.id
    FOR UPDATE
  LOOP$new$;
BEGIN
  SELECT pg_get_functiondef('public.internal_supplier_po_issue(uuid,uuid,text)'::regprocedure) INTO v_definition;
  IF position(v_old IN v_definition)=0 THEN RAISE EXCEPTION 'SUPPLIER_PO_ISSUE_LOCK_BLOCK_NOT_FOUND'; END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END
$migration$;

REVOKE ALL ON FUNCTION public.internal_supplier_po_issue(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_supplier_po_issue(uuid,uuid,text) TO sco_internal_executor;
