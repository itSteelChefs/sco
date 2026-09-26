INSERT INTO public."Permission"(id, code, description) VALUES
  (gen_random_uuid(), 'identity.company.read', 'Read internal company data'),
  (gen_random_uuid(), 'partner.portal.read', 'Read partner portal')
ON CONFLICT (code) DO NOTHING;