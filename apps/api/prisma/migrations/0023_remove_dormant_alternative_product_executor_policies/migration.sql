-- Remove the dormant direct-table executor policies left by Migration 0015.
-- Migration 0021 revoked the corresponding table privileges and replaced this
-- path with fixed, purpose-specific SECURITY DEFINER gateways.

DROP POLICY IF EXISTS alternative_product_internal_executor_select
  ON public.alternative_product_proposals;

DROP POLICY IF EXISTS alternative_product_internal_executor_update
  ON public.alternative_product_proposals;
