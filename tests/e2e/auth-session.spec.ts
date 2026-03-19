import { expect, test } from '@playwright/test';
import {
  DEFAULT_E2E_USER,
  ensureOnboardedUser,
  expectMainShell,
  expectNoUnexpectedRuntimeIssues,
  loginThroughUi,
  trackUnexpectedRuntimeIssues,
} from './helpers/e2e';

test('returning user can sign in and stay authenticated after reload', async ({ page, request }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page);
  await ensureOnboardedUser(request);

  await page.goto('/');
  await loginThroughUi(page, DEFAULT_E2E_USER.username, DEFAULT_E2E_USER.password);
  await expectMainShell(page);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('auth-token')))).toBe(true);

  await page.reload();

  await expectMainShell(page);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('auth-token')))).toBe(true);
  expectNoUnexpectedRuntimeIssues(runtimeIssues);
});

test('invalid credentials keep the user on the login screen', async ({ page, request }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page, {
    extraAllowedHttpErrors: [{ status: 401, pattern: /\/api\/auth\/login$/ }],
  });
  await ensureOnboardedUser(request);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill(DEFAULT_E2E_USER.username);
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.getByText('Invalid username or password')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  await expect(page.evaluate(() => localStorage.getItem('auth-token'))).resolves.toBeNull();
  expectNoUnexpectedRuntimeIssues(runtimeIssues);
});
