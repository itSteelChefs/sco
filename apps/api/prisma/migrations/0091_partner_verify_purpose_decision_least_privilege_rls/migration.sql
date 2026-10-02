DROP POLICY partner_verify_purpose_decision_owner_scope ON public.partner_verify_purpose_decisions;

CREATE POLICY partner_verify_purpose_decision_owner_select
ON public.partner_verify_purpose_decisions
FOR SELECT TO sco_verify_partner_read_owner
USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

CREATE POLICY partner_verify_purpose_decision_owner_insert
ON public.partner_verify_purpose_decisions
FOR INSERT TO sco_verify_partner_read_owner
WITH CHECK (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

CREATE POLICY partner_verify_purpose_decision_owner_delete
ON public.partner_verify_purpose_decisions
FOR DELETE TO sco_verify_partner_read_owner
USING (company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);