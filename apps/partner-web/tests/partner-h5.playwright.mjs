import { expect, test } from '@playwright/test';

const companies = { companies: [
  { id: 'company-a', name: 'Company A', type: 'PARTNER' },
  { id: 'company-b', name: 'Company B', type: 'PARTNER' },
] };

function deferred() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

function companyId(route) {
  return route.request().headers()['x-sco-company-id'];
}

function journey(id, accepted = false) {
  return {
    company: { id, name: id === 'company-a' ? 'Company A' : 'Company B' },
    actor: { userId: 'user-a', membershipId: 'membership-a' },
    operational: { procurementAccess: 'RESTRICTED' },
    relationship: { stage: accepted ? 'APPROVAL' : 'AGREEMENT', qualification: 'APPROVED', partnership: 'UNDER_REVIEW', agreementsSatisfied: accepted, pendingAgreements: accepted ? [] : [{ agreementType: 'BINDING_CONFIDENTIALITY', version: 'v1', status: 'NOT_ACCEPTED', actionable: true }] },
    nextAction: accepted ? { code: 'AWAIT_SCO_REVIEW', owner: 'SCO', permitted: true } : { code: 'ACCEPT_AGREEMENTS', owner: 'PARTNER', permitted: true },
    experiences: [{ code: 'PARTNER_SHELL', classification: 'C', enterable: true }],
    capabilities: [{ code: 'AGREEMENT_ACCEPTANCE', classification: 'B', available: true }],
  };
}

function activeJourney(id) {
  return { ...journey(id, true), relationship: { stage: 'ACTIVE', qualification: 'APPROVED', partnership: 'ACTIVE', agreementsSatisfied: true, pendingAgreements: [] }, nextAction: { code: 'NONE', owner: 'NONE', permitted: true }, operational: { procurementAccess: 'AVAILABLE' } };
}

function agreement({ actionable = true, accepted = false, content = 'Authoritative binding terms v1' } = {}) {
  return [{ agreementType: 'BINDING_CONFIDENTIALITY', version: 'v1', content, effectiveAt: '2026-10-06T00:00:00.000Z', required: true, acceptanceStatus: accepted ? 'ACCEPTED' : 'NOT_ACCEPTED', acceptedVersion: accepted ? 'v1' : null, actionable }];
}

async function setup(page, { journeyHandler, agreementHandler, workspaceHandler } = {}) {
  await page.context().addCookies([{ name: 'sco_session', value: 'test-session', url: 'http://127.0.0.1:4103' }]);
  await page.route('**/api/v1/auth/context', (route) => route.fulfill({ json: companies }));
  await page.route('**/api/v1/partner/journey', (route) => journeyHandler(route));
  await page.route('**/api/v1/partner/admission/agreements/accept', (route) => agreementHandler(route));
  await page.route('**/api/v1/partner/admission/agreements', (route) => agreementHandler(route));
  await page.route('**/api/v1/partner/workspace/current', (route) => workspaceHandler(route));
  await page.goto('/portal');
}

test('renders server-actionable content, accepts only by gesture, refreshes, and never provisions automatically', async ({ page }) => {
  let acceptancePosts = 0;
  let agreementReads = 0;
  let journeyReads = 0;
  let workspacePosts = 0;
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey('company-a', ++journeyReads > 1) }),
    agreementHandler: (route) => {
      if (route.request().method() === 'POST') {
        acceptancePosts += 1;
        return route.fulfill({ json: { agreementType: 'BINDING_CONFIDENTIALITY', version: 'v1', acceptedAt: '2026-10-06T00:00:00.000Z', status: 'ACCEPTED' } });
      }
      agreementReads += 1;
      return route.fulfill({ json: agreement({ accepted: agreementReads > 1, actionable: agreementReads === 1 }) });
    },
    workspaceHandler: (route) => {
      if (route.request().method() === 'POST') workspacePosts += 1;
      return route.fulfill({ json: null });
    },
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await expect(page.getByText('Authoritative binding terms v1')).toBeVisible();
  await expect.poll(() => acceptancePosts).toBe(0);
  await page.getByRole('button', { name: 'أوافق على هذه الاتفاقية' }).dblclick();
  await expect.poll(() => acceptancePosts).toBe(1);
  await expect.poll(() => agreementReads).toBe(2);
  await expect.poll(() => journeyReads).toBe(2);
  await expect(page.getByRole('button', { name: 'أوافق على هذه الاتفاقية' })).not.toBeVisible();
  await expect.poll(() => workspacePosts).toBe(0);
});

test('does not present acceptance when the server marks an agreement non-actionable', async ({ page }) => {
  let acceptancePosts = 0;
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey('company-a') }),
    agreementHandler: (route) => route.request().method() === 'POST'
      ? (acceptancePosts += 1, route.fulfill({ json: {} }))
      : route.fulfill({ json: agreement({ actionable: false }) }),
    workspaceHandler: (route) => route.fulfill({ json: null }),
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await expect(page.getByRole('button', { name: 'أوافق على هذه الاتفاقية' })).not.toBeVisible();
  await expect.poll(() => acceptancePosts).toBe(0);
});

test('does not infer acceptance from required or pending status when actionable is missing', async ({ page }) => {
  const pendingAgreement = agreement();
  delete pendingAgreement[0].actionable;
  let acceptancePosts = 0;
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey('company-a') }),
    agreementHandler: (route) => route.request().method() === 'POST'
      ? (acceptancePosts += 1, route.fulfill({ json: {} }))
      : route.fulfill({ json: pendingAgreement }),
    workspaceHandler: (route) => route.fulfill({ json: null }),
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await expect(page.getByRole('button', { name: 'أوافق على هذه الاتفاقية' })).not.toBeVisible();
  await expect.poll(() => acceptancePosts).toBe(0);
});

test('company switches and logout invalidate pending acceptance without stale UI updates', async ({ page }) => {
  const pending = deferred();
  let acceptancePosts = 0;
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: companyId(route) === 'company-a' ? journey('company-a') : activeJourney('company-b') }),
    agreementHandler: async (route) => {
      if (route.request().method() === 'POST') {
        acceptancePosts += 1;
        await pending.promise;
        return route.fulfill({ json: { agreementType: 'BINDING_CONFIDENTIALITY', version: 'v1', acceptedAt: '2026-10-06T00:00:00.000Z', status: 'ACCEPTED' } });
      }
      return route.fulfill({ json: companyId(route) === 'company-a' ? agreement() : [] });
    },
    workspaceHandler: (route) => route.fulfill({ json: null }),
  });
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ json: { ok: true } }));
  await page.getByLabel('الشركة').selectOption('company-a');
  await page.getByRole('button', { name: 'أوافق على هذه الاتفاقية' }).click();
  await expect.poll(() => acceptancePosts).toBe(1);
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  pending.release();
  await expect(page.getByText('Authoritative binding terms v1')).not.toBeVisible();
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
