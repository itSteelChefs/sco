import { expect, test } from '@playwright/test';

const email = 'seed.owner@sco.test';
const password = 'sco-test-seed-password';

test.describe('Partner launch foundation', () => {
  test('redirects an anonymous visitor to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('shows an accessible error for failed login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill('incorrect-password');
    await page.getByRole('button', { name: 'دخول' }).click();
    await expect(page.getByText('بيانات الدخول غير صحيحة.')).toBeVisible();
  });

  test('requires explicit company selection after successful login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(password);
    await page.getByRole('button', { name: 'دخول' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'اختر الشركة' })).toBeVisible();
  });

  test('clears the session and redirects on logout', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(password);
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('keeps the Partner session visible and shows an Arabic recovery error when logout fails', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(password);
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 500, body: JSON.stringify({ error: { code: 'INTERNAL_ERROR' } }) }));
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page.getByText('تعذر إنهاء الجلسة بأمان. حاول مرة أخرى.', { exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test('redirects an expired browser session safely to login', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(password);
    await page.getByRole('button', { name: 'دخول' }).click();
    await context.clearCookies();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('shows a recoverable state when the company-context API is unavailable', async ({ page }) => {
    await page.goto('/login');
    await page.route('**/api/v1/auth/context', (route) => route.abort('failed'));
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(password);
    await page.getByRole('button', { name: 'دخول' }).click();
    await expect(page.getByText('تعذر تحميل سياق الشركة.')).toBeVisible();
  });
});

test.describe('Operations launch foundation', () => {
  test.use({ baseURL: 'http://127.0.0.1:3103' });

  test('redirects an anonymous visitor to login', async ({ page }) => {
    await page.goto('/companies');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('shows permission denied rather than internal data after company selection', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(password);
    await page.getByRole('button', { name: 'دخول' }).click();
    await expect(page.getByLabel('شركة العمليات')).toBeVisible();
    await page.getByLabel('شركة العمليات').selectOption({ label: 'SCO Development' });
    await expect(page.getByText('لا تملك صلاحية عرض الشركات في هذا السياق.')).toBeVisible();
  });

  test('clears the operations session on logout', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(password);
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('keeps the Operations session visible when logout has a network failure', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(password);
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.route('**/api/v1/auth/logout', (route) => route.abort('failed'));
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page.getByText('تعذر إنهاء الجلسة بأمان. حاول مرة أخرى.', { exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login$/);
  });
});