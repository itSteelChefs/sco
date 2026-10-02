DROP POLICY partner_verify_purpose_decision_owner_select ON public.partner_verify_purpose_decisions;
CREATE POLICY partner_verify_purpose_decision_owner_select
ON public.partner_verify_purpose_decisions
FOR SELECT TO sco_verify_partner_read_owner
USING (
  expires_at <= clock_timestamp()
  OR company_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
);