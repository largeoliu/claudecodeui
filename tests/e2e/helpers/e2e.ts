import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

type SessionPayload = {
  token: string;
  user: {
    id: number;
    username: string;
  };
};

export const DEFAULT_E2E_USER = {
  username: 'playwright-e2e',
  password: 'Passw0rd!123',
  gitName: 'Playwright E2E',
  gitEmail: 'playwright@example.com',
};

const allowedConsoleErrorPatterns = [
  /Failed to check TaskMaster installation status/,
  /Failed to load resource: the server responded with a status of \d+ \(.+\)/,
  /Failed to load resource: the server responded with a status of 403 \(\)/,
  /Error fetching MCP servers:/,
];

const allowedHttpErrors = [
  { status: 401, pattern: /\/api\/auth\/user$/ },
  { status: 401, pattern: /\/api\/user\/onboarding-status$/ },
  { status: 401, pattern: /\/api\/plugins$/ },
  { pattern: /\/api\/taskmaster\/installation-status$/ },
  { status: 500, pattern: /\/api\/mcp\/cli\/list$/ },
  { status: 403, pattern: /\/repos\/siteboon\/claudecodeui\/releases\/latest$/ },
];

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function uniqueName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function getE2eRoot() {
  const root = process.env.PLAYWRIGHT_E2E_ROOT;
  if (!root) {
    throw new Error('PLAYWRIGHT_E2E_ROOT is not set. Run tests via npm run test:e2e or npm run test:e2e:smoke.');
  }

  return root;
}

export function getWorkspaceRoot() {
  return process.env.PLAYWRIGHT_E2E_WORKSPACE_ROOT || path.join(getE2eRoot(), 'workspaces');
}

export async function createWorkspaceDir(prefix: string) {
  const dirPath = path.join(getWorkspaceRoot(), uniqueName(prefix));
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function createExistingWorkspace(prefix: string) {
  const dirPath = await createWorkspaceDir(prefix);
  await fs.writeFile(path.join(dirPath, 'README.md'), `# ${path.basename(dirPath)}\n`, 'utf8');
  return dirPath;
}

export async function createGitWorkspace(prefix: string) {
  const dirPath = await createWorkspaceDir(prefix);

  execFileSync('git', ['init', '-b', 'main'], { cwd: dirPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', DEFAULT_E2E_USER.gitName], { cwd: dirPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', DEFAULT_E2E_USER.gitEmail], { cwd: dirPath, stdio: 'ignore' });

  const fileName = 'notes.txt';
  const filePath = path.join(dirPath, fileName);
  await fs.writeFile(filePath, 'first line\n', 'utf8');
  execFileSync('git', ['add', fileName], { cwd: dirPath, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'chore: initial commit'], { cwd: dirPath, stdio: 'ignore' });

  await fs.writeFile(filePath, 'first line\nsecond line\n', 'utf8');

  return {
    dirPath,
    fileName,
    displayName: path.basename(dirPath),
  };
}

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

export function trackUnexpectedRuntimeIssues(
  page: Page,
  options?: {
    extraAllowedHttpErrors?: Array<{ status?: number; pattern: RegExp }>;
  },
) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const httpErrors: string[] = [];
  const mergedAllowedHttpErrors = [...allowedHttpErrors, ...(options?.extraAllowedHttpErrors || [])];

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

    if (mergedAllowedHttpErrors.some((rule) => {
      const pathname = new URL(response.url()).pathname;
      if (!rule.pattern.test(pathname)) {
        return false;
      }

      if ('status' in rule && rule.status !== undefined) {
        return rule.status === response.status();
      }

      return true;
    })) {
      return;
    }

    httpErrors.push(`${response.status()} ${response.url()}`);
  });

  return { consoleErrors, pageErrors, httpErrors };
}

export function expectNoUnexpectedRuntimeIssues(runtimeIssues: {
  consoleErrors: string[];
  pageErrors: string[];
  httpErrors: string[];
}) {
  expect(runtimeIssues.consoleErrors).toEqual([]);
  expect(runtimeIssues.pageErrors).toEqual([]);
  expect(runtimeIssues.httpErrors).toEqual([]);
}

export async function ensureOnboardedUser(request: APIRequestContext) {
  const hashedPassword = crypto.createHash('sha256').update(DEFAULT_E2E_USER.password).digest('hex');
  const statusResponse = await request.get('/api/auth/status');
  expect(statusResponse.ok()).toBeTruthy();
  const statusPayload = getJson<{ needsSetup: boolean }>(await statusResponse.text());

  const sessionResponse = statusPayload.needsSetup
    ? await request.post('/api/auth/register', {
        data: {
          username: DEFAULT_E2E_USER.username,
          password: hashedPassword,
        },
      })
    : await request.post('/api/auth/login', {
        data: {
          username: DEFAULT_E2E_USER.username,
          password: hashedPassword,
        },
      });

  expect(sessionResponse.ok()).toBeTruthy();
  const sessionPayload = getJson<SessionPayload>(await sessionResponse.text());

  const authHeaders = {
    Authorization: `Bearer ${sessionPayload.token}`,
  };

  const gitConfigResponse = await request.post('/api/user/git-config', {
    headers: authHeaders,
    data: {
      gitName: DEFAULT_E2E_USER.gitName,
      gitEmail: DEFAULT_E2E_USER.gitEmail,
    },
  });
  expect(gitConfigResponse.ok()).toBeTruthy();

  const onboardingResponse = await request.post('/api/user/complete-onboarding', {
    headers: authHeaders,
  });
  expect(onboardingResponse.ok()).toBeTruthy();

  return {
    token: sessionPayload.token,
    username: DEFAULT_E2E_USER.username,
    password: DEFAULT_E2E_USER.password,
  };
}

export async function primeAuthenticatedPage(page: Page, token: string) {
  await page.addInitScript((nextToken: string) => {
    localStorage.setItem('auth-token', nextToken);
  }, token);
}

export async function loginThroughUi(page: Page, username: string, password: string) {
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

export async function expectMainShell(page: Page) {
  await expect(page.getByRole('heading', { name: 'Choose Your Project' })).toBeVisible();
}

export async function expectAppReady(page: Page) {
  await expect(page.getByTitle('Create new project')).toBeVisible();
  await expect(page.locator('button').filter({ hasText: /^Settings$/ }).first()).toBeVisible();
}

export async function openSettings(page: Page) {
  await page.locator('button').filter({ hasText: /^Settings$/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
}

export async function createProjectViaApi(request: APIRequestContext, token: string, workspaceType: 'existing' | 'new', workspacePath: string) {
  const response = await request.post('/api/projects/create-workspace', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: {
      workspaceType,
      path: workspacePath,
    },
  });

  expect(response.ok()).toBeTruthy();
  return getJson<{ success: boolean; project: { displayName: string; name: string; fullPath: string } }>(await response.text());
}

export async function selectProject(page: Page, displayName: string) {
  const projectButton = page.getByRole('button', {
    name: new RegExp(escapeRegex(displayName)),
  }).first();
  await expect(projectButton).toBeVisible();
  await projectButton.click();
}

export function getLatestCommitMessage(repoPath: string) {
  return execFileSync('git', ['log', '-1', '--pretty=%s'], {
    cwd: repoPath,
    encoding: 'utf8',
  }).trim();
}
