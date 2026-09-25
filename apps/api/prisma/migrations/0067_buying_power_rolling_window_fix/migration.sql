DO $$
DECLARE
  definition text;
  needle text := 'FROM procurement_needs n WHERE n.id=ANY(COALESCE(p_need_ids,ARRAY[]::uuid[]))';
  replacement text := 'FROM procurement_needs n WHERE n.id=ANY(COALESCE(p_need_ids,ARRAY[]::uuid[])) AND (p_horizon <> ''ROLLING_PLANNED'' OR (n.need_date >= p_bucket AND n.need_date < p_bucket + 90))';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO definition
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND p.proname='internal_buying_power_classified_run'
     AND pg_get_function_identity_arguments(p.oid)='p_actor uuid, p_horizon text, p_bucket date, p_request_key text, p_need_ids uuid[], p_line_ids uuid[], p_correlation text';
  IF definition IS NULL OR strpos(definition, needle)=0 THEN
    RAISE EXCEPTION 'BUYING_POWER_CLASSIFICATION_GATEWAY_DEFINITION_UNEXPECTED';
  END IF;
  definition := replace(definition, needle, replacement);
  EXECUTE definition;
END $$;
