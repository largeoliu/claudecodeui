import { expect, test, type Page } from '@playwright/test';

const allowedConsoleErrorPatterns = [
  /Failed to check TaskMaster installation status/,
  /Failed to load resource: the server responded with a status of \d+ \(.+\)/,
  /Error fetching MCP servers:/,
];

const allowedHttpErrors = [
  { status: 401, pattern: /\/api\/auth\/user$/ },
  { status: 401, pattern: /\/api\/user\/onboarding-status$/ },
  { status: 401, pattern: /\/api\/plugins$/ },
  { pattern: /\/api\/taskmaster\/installation-status$/ },
  { status: 500, pattern: /\/api\/mcp\/cli\/list$/ },
];

function isAllowedHttpError(status: number, urlString: string) {
  const pathname = new URL(urlString).pathname;

  return allowedHttpErrors.some((rule) => {
    if (!rule.pattern.test(pathname)) {
      return false;
    }

    if ('status' in rule) {
      return rule.status === status;
    }

    return true;
  });
}

function trackUnexpectedRuntimeIssues(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const httpErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    const text = message.text();
    if (allowedConsoleErrorPatterns.some((pattern) => pattern.test(text))) {
      return;
    }

    consoleErrors.push(text);
  });

  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
  });

  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }

    if (isAllowedHttpError(response.status(), response.url())) {
      return;
    }

    httpErrors.push(`${response.status()} ${response.url()}`);
  });

  return { consoleErrors, pageErrors, httpErrors };
}

test('user can complete onboarding and open settings', async ({ page }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page);
  const uniqueSuffix = `${Date.now()}`;
  const username = `e2e_${uniqueSuffix}`;
  const password = 'Passw0rd!123';

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Welcome to Claude Code UI' })).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create Account' }).click();

  await expect(page.getByRole('heading', { name: 'Git Configuration' })).toBeVisible();
  await page.getByRole('textbox', { name: /^Git Name/ }).fill('Playwright Test User');
  await page.getByRole('textbox', { name: /^Git Email/ }).fill('playwright@example.com');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Connect Your AI Agents' })).toBeVisible();
  await page.getByRole('button', { name: 'Complete Setup' }).click();

  await expect(page.getByRole('heading', { name: 'Choose Your Project' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('auth-token')))).toBe(true);

  await page.locator('button').filter({ hasText: /^Settings$/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agents' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Appearance' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible();

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Choose Your Project' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('auth-token')))).toBe(true);

  expect(runtimeIssues.consoleErrors).toEqual([]);
  expect(runtimeIssues.pageErrors).toEqual([]);
  expect(runtimeIssues.httpErrors).toEqual([]);
});
