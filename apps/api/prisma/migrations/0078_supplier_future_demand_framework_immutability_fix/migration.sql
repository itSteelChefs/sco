CREATE OR REPLACE FUNCTION public.prevent_supplier_future_demand_framework_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR COALESCE(current_setting('app.supplier_future_demand_framework_gateway', true), '') <> 'true' THEN
    RAISE EXCEPTION 'SUPPLIER_FUTURE_DEMAND_FRAMEWORK_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;