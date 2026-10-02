-- The restricted SECURITY DEFINER owner is subject to FORCE RLS. Its decision rows are always scoped to the
-- transaction-local tenant set by the issuer/consumer functions; runtime receives no table privilege.
CREATE POLICY partner_verify_purpose_decision_owner_scope
ON public.partner_verify_purpose_decisions
FOR ALL TO sco_verify_partner_read_owner
USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID)
WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);