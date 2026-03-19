import { expect, test } from '@playwright/test';
import {
  expectAppReady,
  ensureOnboardedUser,
  expectNoUnexpectedRuntimeIssues,
  openSettings,
  primeAuthenticatedPage,
  trackUnexpectedRuntimeIssues,
} from './helpers/e2e';

test('code editor font size persists after reload', async ({ page, request }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page);
  const session = await ensureOnboardedUser(request);

  await primeAuthenticatedPage(page, session.token);
  await page.goto('/');
  await expectAppReady(page);

  await openSettings(page);
  await page.getByRole('button', { name: 'Appearance' }).first().click();

  const minimapToggle = page.getByRole('switch', { name: 'Show Minimap' });
  await expect(minimapToggle).toHaveAttribute('aria-checked', 'true');
  await minimapToggle.click();
  await expect(minimapToggle).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('codeEditorShowMinimap'))).toBe('false');

  await page.reload();
  await expectAppReady(page);

  await openSettings(page);
  await page.getByRole('button', { name: 'Appearance' }).first().click();
  await expect(page.getByRole('switch', { name: 'Show Minimap' })).toHaveAttribute('aria-checked', 'false');
  expectNoUnexpectedRuntimeIssues(runtimeIssues);
});
