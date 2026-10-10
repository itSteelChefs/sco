import { expect, test } from '@playwright/test';

const deferredWaiters = new Set();

function deferred() {
  let settled = false;
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const release = (value) => {
    if (settled) return;
    settled = true;
    deferredWaiters.delete(release);
    resolve(value);
  };
  deferredWaiters.add(release);
  return { promise, release };
}

test.afterEach(() => {
  for (const release of deferredWaiters) release();
  deferredWaiters.clear();
});

const companies = { companies: [
  { id: 'company-a', name: 'Company A', type: 'PARTNER' },
  { id: 'company-b', name: 'Company B', type: 'PARTNER' },
] };

const journey = (companyId, stage = 'ACTIVE', enterable = true, procurementAccess = 'AVAILABLE') => ({
  company: { id: companyId, name: companyId === 'company-a' ? 'Company A' : 'Company B' },
  actor: { userId: 'user-a', membershipId: 'membership-a' },
  operational: { procurementAccess },
  relationship: { stage, qualification: 'APPROVED', partnership: stage === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED', agreementsSatisfied: stage === 'ACTIVE', pendingAgreements: [] },
  nextAction: stage === 'ACTIVE' ? { code: 'NONE', owner: 'NONE', permitted: true } : { code: 'CONTACT_SCO', owner: 'SCO', permitted: true },
  experiences: [
    { code: 'PARTNER_SHELL', classification: 'C', enterable },
    { code: 'ONBOARDING', classification: 'B', enterable: true },
    { code: 'PROCUREMENT', classification: 'D', enterable: procurementAccess === 'AVAILABLE' },
  ],
  capabilities: [],
});

async function setup(page, { contextHandler, journeyHandler, workspaceHandler, agreementsHandler } = {}) {
  await page.context().addCookies([{ name: 'sco_session', value: 'test-session', url: 'http://127.0.0.1:4102' }]);
  await page.route('**/api/v1/auth/context', (route) => contextHandler?.(route) ?? route.fulfill({ json: companies }));
  await page.route('**/api/v1/partner/journey', (route) => journeyHandler(route));
  await page.route('**/api/v1/partner/workspace/current', (route) => workspaceHandler?.(route));
  await page.route('**/api/v1/partner/admission/agreements', (route) => agreementsHandler?.(route));
  await page.route('**/api/v1/partner/admission/agreements/accept', (route) => agreementsHandler?.(route));
  await page.goto('/portal');
}

function companyId(route) {
  return route.request().headers()['x-sco-company-id'];
}

test('A→B ignores late Journey failure and keeps only B state', async ({ page }) => {
  let aOutcome = 'success';
  const pendingA = deferred();
  await setup(page, {
    journeyHandler: (route) => companyId(route) === 'company-a'
      ? pendingA.promise.then(() => aOutcome === 'failure'
        ? route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN' } } })
        : route.fulfill({ json: journey('company-a', 'SUSPENDED') }))
      : route.fulfill({ json: journey('company-b') }),
    workspaceHandler: (route) => route.fulfill({ json: null }),
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByText('حالة الشراكة: ACTIVE')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  aOutcome = 'failure';
  pendingA.release();
  await expect.poll(() => page.getByText('حالة الشراكة: ACTIVE').isVisible()).toBe(true);
  await expect(page.getByText('حالة الشراكة: ACTIVE')).toBeVisible();
  await expect(page.getByText('لا تملك صلاحية الوصول لهذه الشركة.')).not.toBeVisible();
});

test('B→A and A1→B→A2 keep only the latest A2 response', async ({ page }) => {
  const pending = new Map();
  await setup(page, {
    journeyHandler: (route) => {
      const id = companyId(route);
      const waits = pending.get(id) ?? [];
      pending.set(id, waits);
      waits.push(route);
      if (id === 'company-b' && waits.length === 1) route.fulfill({ json: journey('company-b', 'SUSPENDED') });
    },
    workspaceHandler: (route) => route.fulfill({ json: null }),
  });
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByText('جارٍ التحميل...')).toBeVisible();
  await page.getByLabel('الشركة').selectOption('company-a');
  await page.getByLabel('الشركة').selectOption('company-b');
  await page.getByLabel('الشركة').selectOption('company-a');
  await expect.poll(() => pending.get('company-a')?.length ?? 0).toBe(2);
  const aRequests = pending.get('company-a');
  await aRequests.at(-1).fulfill({ json: journey('company-a') });
  await expect(page.getByText('حالة الشراكة: ACTIVE')).toBeVisible();
  await aRequests[0]?.fulfill({ json: journey('company-a', 'SUSPENDED') });
  await expect(page.getByText('حالة الشراكة: ACTIVE')).toBeVisible();
});

test('Workspace GET 401 redirects and explicit provisioning dispatches exactly once', async ({ page }) => {
  let postCount = 0;
  const postPending = deferred();
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey('company-a') }),
    workspaceHandler: async (route) => {
      if (route.request().method() === 'POST') {
        postCount += 1;
        await postPending.promise;
        return route.fulfill({ json: { id: 'workspace-a', displayName: 'Workspace A', state: 'ACTIVE', version: 1, capabilities: [], capabilityStates: [] } });
      }
      return route.fulfill({ json: null });
    },
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await expect(page.getByRole('button', { name: 'إنشاء مساحة العمل' })).toBeVisible();
  await page.getByRole('button', { name: 'إنشاء مساحة العمل' }).dblclick();
  await expect.poll(() => postCount).toBe(1);
  postPending.release();
  await expect(page.getByText('Workspace A')).toBeVisible();
});

test('Workspace GET current-generation 401 redirects to login', async ({ page }) => {
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey('company-a') }),
    workspaceHandler: (route) => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await expect(page).toHaveURL(/\/login$/);
});

test('POST 401 clears the sensitive flow and redirects to login', async ({ page }) => {
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey('company-a') }),
    workspaceHandler: (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } })
      : route.fulfill({ json: null }),
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await page.getByRole('button', { name: 'إنشاء مساحة العمل' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('POST pending A cannot update B after company switch, and POST 403 cannot show success', async ({ page }) => {
  let postOutcome = 'success';
  const postPending = deferred();
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey(companyId(route)) }),
    workspaceHandler: async (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: null });
      await postPending.promise;
      return postOutcome === 'forbidden'
        ? route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN' } } })
        : route.fulfill({ json: { id: 'workspace-a', displayName: 'Workspace A', state: 'ACTIVE', version: 1, capabilities: [], capabilityStates: [] } });
    },
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await page.getByRole('button', { name: 'إنشاء مساحة العمل' }).click();
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  postPending.release();
  await expect(page.getByText('Workspace A')).not.toBeVisible();

  postOutcome = 'forbidden';
  await page.getByRole('button', { name: 'إنشاء مساحة العمل' }).click();
  await expect(page.getByText('لا تملك صلاحية إنشاء مساحة العمل.')).toBeVisible();
  await expect(page.getByText('Workspace A')).not.toBeVisible();
});

test('stale Workspace success cannot overwrite the current company', async ({ page }) => {
  const pendingA = deferred();
  const observedA = deferred();
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey(companyId(route)) }),
    workspaceHandler: async (route) => {
      if (companyId(route) === 'company-a') {
        observedA.release();
        await pendingA.promise;
        return route.fulfill({ json: { id: 'workspace-a', displayName: 'Workspace A', state: 'ACTIVE', version: 1, capabilities: [], capabilityStates: [] } });
      }
      return route.fulfill({ json: null });
    },
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await observedA.promise;
  await expect(page.getByRole('heading', { name: 'Company A' })).toBeVisible();
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  pendingA.release();
  await expect(page.getByText('Workspace A')).not.toBeVisible();
});

test('stale Workspace 403 cannot erase the current company', async ({ page }) => {
  const pendingA = deferred();
  const observedA = deferred();
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey(companyId(route)) }),
    workspaceHandler: async (route) => {
      if (companyId(route) === 'company-a') {
        observedA.release();
        await pendingA.promise;
        return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN' } } });
      }
      return route.fulfill({ json: null });
    },
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await observedA.promise;
  await expect(page.getByRole('heading', { name: 'Company A' })).toBeVisible();
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  pendingA.release();
  await expect(page.getByText('لا تملك صلاحية الوصول لهذه الشركة.')).not.toBeVisible();
});

test('stale Workspace phase does not affect a later company transition', async ({ page }) => {
  const pendingA = deferred();
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey(companyId(route)) }),
    workspaceHandler: async (route) => {
      if (companyId(route) === 'company-a') {
        await pendingA.promise;
        return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN' } } });
      }
      return route.fulfill({ json: null });
    },
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await page.getByRole('heading', { name: 'Company A' }).waitFor();
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  pendingA.release();
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
});

test('real logout during a pending POST unmounts the flow before late completion', async ({ page }) => {
  const postPending = deferred();
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey('company-a') }),
    workspaceHandler: async (route) => {
      if (route.request().method() === 'POST') {
        await postPending.promise;
        return route.fulfill({ json: { id: 'workspace-a', displayName: 'Workspace A', state: 'ACTIVE', version: 1, capabilities: [], capabilityStates: [] } });
      }
      return route.fulfill({ json: null });
    },
  });
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ json: { ok: true } }));
  await page.getByLabel('الشركة').selectOption('company-a');
  await page.getByRole('button', { name: 'إنشاء مساحة العمل' }).click();
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  postPending.release();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Workspace A')).not.toBeVisible();
});

test('current Journey 401 clears the flow and redirects without a retry surface', async ({ page }) => {
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
    workspaceHandler: (route) => route.fulfill({ json: null }),
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).not.toBeVisible();
});

test('current Journey 403 renders sanitized denial and retry starts a fresh request', async ({ page }) => {
  let journeyCalls = 0;
  await setup(page, {
    journeyHandler: (route) => {
      journeyCalls += 1;
      return journeyCalls === 1
        ? route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', detail: 'secret' } } })
        : route.fulfill({ json: journey('company-a') });
    },
    workspaceHandler: (route) => route.fulfill({ json: null }),
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await expect(page.getByText('لا تملك صلاحية الوصول لهذه الشركة.')).toBeVisible();
  await expect(page.getByText('secret')).not.toBeVisible();
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
  await expect.poll(() => journeyCalls).toBe(2);
  await expect(page.getByText('حالة الشراكة: ACTIVE')).toBeVisible();
});

test('stale Journey 401 cannot redirect or clear the current company', async ({ page }) => {
  const pendingA = deferred();
  await setup(page, {
    journeyHandler: (route) => companyId(route) === 'company-a'
      ? pendingA.promise.then(() => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }))
      : route.fulfill({ json: journey('company-b') }),
    workspaceHandler: (route) => route.fulfill({ json: null }),
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByText('حالة الشراكة: ACTIVE')).toBeVisible();
  pendingA.release();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  await expect(page.getByText('Workspace A')).not.toBeVisible();
});

test('stale Workspace GET 401 cannot redirect or erase the current company', async ({ page }) => {
  const pendingA = deferred();
  const requestA = deferred();
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey(companyId(route)) }),
    workspaceHandler: async (route) => {
      if (companyId(route) === 'company-a') {
        requestA.release();
        await pendingA.promise;
        return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } });
      }
      return route.fulfill({ json: null });
    },
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await requestA.promise;
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  pendingA.release();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
});

test('current Workspace GET 403 renders sanitized denial without redirect', async ({ page }) => {
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey('company-a') }),
    workspaceHandler: (route) => route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', detail: 'secret' } } }),
  });
  await page.getByLabel('الشركة').selectOption('company-a');
  await expect(page.getByText('لا تملك صلاحية الوصول لهذه الشركة.')).toBeVisible();
  await expect(page.getByText('secret')).not.toBeVisible();
  await expect(page).toHaveURL(/\/portal$/);
});

async function startPendingProvisioning(page) {
  await page.getByLabel('الشركة').selectOption('company-a');
  await page.getByRole('button', { name: 'إنشاء مساحة العمل' }).click();
}

test('stale Workspace POST 401 cannot log out the newer company', async ({ page }) => {
  const pendingPost = deferred();
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey(companyId(route)) }),
    workspaceHandler: async (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: null });
      await pendingPost.promise;
      return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } });
    },
  });
  await startPendingProvisioning(page);
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  pendingPost.release();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  await expect(page.getByText('لا تملك صلاحية إنشاء مساحة العمل.')).not.toBeVisible();
});

test('stale Workspace POST 403 cannot render denial under the newer company', async ({ page }) => {
  const pendingPost = deferred();
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey(companyId(route)) }),
    workspaceHandler: async (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: null });
      await pendingPost.promise;
      return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN' } } });
    },
  });
  await startPendingProvisioning(page);
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  pendingPost.release();
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  await expect(page.getByText('لا تملك صلاحية إنشاء مساحة العمل.')).not.toBeVisible();
});

test('context failure retry starts a new context request and resumes without provisioning', async ({ page }) => {
  let contextCalls = 0;
  let postCount = 0;
  await setup(page, {
    contextHandler: (route) => {
      contextCalls += 1;
      return contextCalls === 1
        ? route.fulfill({ status: 500, json: { error: { code: 'TEMPORARY' } } })
        : route.fulfill({ json: companies });
    },
    journeyHandler: (route) => route.fulfill({ json: journey(companyId(route)) }),
    workspaceHandler: (route) => {
      if (route.request().method() === 'POST') postCount += 1;
      return route.fulfill({ json: null });
    },
  });
  await expect(page.getByText('تعذر تحميل سياق الشركة.')).toBeVisible();
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
  await expect.poll(() => contextCalls).toBe(2);
  await page.getByLabel('الشركة').selectOption('company-a');
  await expect(page.getByText('حالة الشراكة: ACTIVE')).toBeVisible();
  await expect.poll(() => postCount).toBe(0);
});

test('stale provisioning finally cannot clear a newer company provisioning state', async ({ page }) => {
  let postCount = 0;
  const pendingA = deferred();
  await setup(page, {
    journeyHandler: (route) => route.fulfill({ json: journey(companyId(route)) }),
    workspaceHandler: async (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: null });
      postCount += 1;
      if (postCount === 1) {
        await pendingA.promise;
        return route.fulfill({ json: { id: 'workspace-a', displayName: 'Workspace A', state: 'ACTIVE', version: 1, capabilities: [], capabilityStates: [] } });
      }
      return route.fulfill({ json: { id: 'workspace-b', displayName: 'Workspace B', state: 'ACTIVE', version: 1, capabilities: [], capabilityStates: [] } });
    },
  });
  await startPendingProvisioning(page);
  await page.getByLabel('الشركة').selectOption('company-b');
  await expect(page.getByRole('heading', { name: 'Company B' })).toBeVisible();
  await page.getByRole('button', { name: 'إنشاء مساحة العمل' }).click();
  await expect.poll(() => postCount).toBe(2);
  pendingA.release();
  await expect(page.getByText('Workspace B')).toBeVisible();
  await expect(page.getByText('Workspace A')).not.toBeVisible();
});
