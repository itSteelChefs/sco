-- Migration 0026 allowed a missing app.pricing_gateway because NULL <> 'true' is NULL.
-- All pricing-history triggers call this function, so the replacement closes that gap atomically.
CREATE OR REPLACE FUNCTION public.prevent_pricing_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR COALESCE(current_setting('app.pricing_gateway',true), '') <> 'true' THEN
    RAISE EXCEPTION 'PRICING_HISTORY_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
