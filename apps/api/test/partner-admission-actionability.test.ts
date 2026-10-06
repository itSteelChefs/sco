import { describe, expect, it } from 'vitest';
import { PartnerAdmissionService } from '../src/modules/identity/partner-admission.service.js';

function serviceFor(status: { partnership_status: string | null; qualification_status: string | null }, canAccept = true) {
  const tenants = {
    withTenant: async (_userId: string, _companyId: string, run: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => run({
      query: async (sql) => sql.includes('partner_agreement_current')
        ? { rows: [{ agreement_type: 'BINDING_CONFIDENTIALITY', version_code: 'v1', content_text: 'Terms', effective_at: new Date(), required: true, acceptance_status: 'NOT_ACCEPTED', accepted_version_code: null }] }
        : { rows: [status] },
    }),
  };
  const permissions = { has: async () => canAccept };
  return new PartnerAdmissionService(tenants as never, permissions as never);
}

describe('PartnerAdmissionService agreement actionability', () => {
  it('returns server-derived actionable false for SUSPENDED partnership', async () => {
    const agreements = await serviceFor({ partnership_status: 'SUSPENDED', qualification_status: 'APPROVED' }).agreements({ userId: 'actor', companyId: 'company' } as never);
    expect(agreements[0]).toMatchObject({ actionable: false, acceptanceStatus: 'NOT_ACCEPTED' });
  });

  it('returns server-derived actionable true for an approved qualification and resolvable partnership', async () => {
    const agreements = await serviceFor({ partnership_status: 'UNDER_REVIEW', qualification_status: 'APPROVED' }).agreements({ userId: 'actor', companyId: 'company' } as never);
    expect(agreements[0]).toMatchObject({ actionable: true, acceptanceStatus: 'NOT_ACCEPTED' });
  });

  it('returns server-derived actionable false when the actor lacks acceptance permission', async () => {
    const agreements = await serviceFor({ partnership_status: 'UNDER_REVIEW', qualification_status: 'APPROVED' }, false).agreements({ userId: 'actor', companyId: 'company', membershipId: 'membership' } as never);
    expect(agreements[0]).toMatchObject({ actionable: false, acceptanceStatus: 'NOT_ACCEPTED' });
  });
});
