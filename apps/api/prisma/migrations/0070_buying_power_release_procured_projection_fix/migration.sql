DO $$
DECLARE
  definition text;
  needle text := '0::numeric AS released_quantity,0::numeric AS procured_quantity';
  replacement text := 'r.released_quantity AS released_quantity,r.procured_quantity AS procured_quantity';
  at_pos integer;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO definition
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND p.proname='internal_buying_power_classified_run'
     AND pg_get_function_identity_arguments(p.oid)='p_actor uuid, p_horizon text, p_bucket date, p_request_key text, p_need_ids uuid[], p_line_ids uuid[], p_correlation text';
  at_pos := strpos(definition, needle);
  IF definition IS NULL OR at_pos=0 THEN
    RAISE EXCEPTION 'BUYING_POWER_RELEASE_PROJECTION_DEFINITION_UNEXPECTED';
  END IF;
  definition := substr(definition,1,at_pos-1) || replacement || substr(definition,at_pos+length(needle));
  EXECUTE definition;
END $$;
