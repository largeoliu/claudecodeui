import { expect, test } from '@playwright/test';
import {
  createExistingWorkspace,
  createWorkspaceDir,
  escapeRegex,
  expectAppReady,
  ensureOnboardedUser,
  expectNoUnexpectedRuntimeIssues,
  primeAuthenticatedPage,
  selectProject,
  trackUnexpectedRuntimeIssues,
} from './helpers/e2e';

test('user can add an existing workspace through the project wizard', async ({ page, request }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page);
  const session = await ensureOnboardedUser(request);
  const workspacePath = await createExistingWorkspace('existing-workspace');
  const workspaceName = workspacePath.split('/').pop() || workspacePath;

  await primeAuthenticatedPage(page, session.token);
  await page.goto('/');
  await expectAppReady(page);

  await page.getByTitle('Create new project').click();
  await expect(page.getByRole('heading', { name: 'Create New Project' })).toBeVisible();
  await page.getByRole('button', { name: 'Existing Workspace' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByPlaceholder('/path/to/existing/workspace').fill(workspacePath);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText(workspacePath, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create Project' }).click();

  await expect(page.getByRole('heading', { name: 'Create New Project' })).toBeHidden();
  await selectProject(page, workspaceName);
  await expect(page.getByText(new RegExp(`^${escapeRegex(workspaceName)}$`)).last()).toBeVisible();
  expectNoUnexpectedRuntimeIssues(runtimeIssues);
});

test('user can create a new empty workspace through the project wizard', async ({ page, request }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page);
  const session = await ensureOnboardedUser(request);
  const workspacePath = await createWorkspaceDir('new-workspace');
  const workspaceName = workspacePath.split('/').pop() || workspacePath;

  await primeAuthenticatedPage(page, session.token);
  await page.goto('/');
  await expectAppReady(page);

  await page.getByTitle('Create new project').click();
  await expect(page.getByRole('heading', { name: 'Create New Project' })).toBeVisible();
  await page.getByRole('button', { name: 'New Workspace' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByPlaceholder('/path/to/new/workspace').fill(workspacePath);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText(workspacePath, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create Project' }).click();

  await expect(page.getByRole('heading', { name: 'Create New Project' })).toBeHidden();
  await selectProject(page, workspaceName);
  await expect(page.getByText(new RegExp(`^${escapeRegex(workspaceName)}$`)).last()).toBeVisible();
  expectNoUnexpectedRuntimeIssues(runtimeIssues);
});

test('project wizard shows a validation error for a missing existing workspace', async ({ page, request }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page, {
    extraAllowedHttpErrors: [{ status: 404, pattern: /\/api\/projects\/create-workspace$/ }],
  });
  const session = await ensureOnboardedUser(request);
  const missingPath = `${await createWorkspaceDir('missing-root')}/does-not-exist`;

  await primeAuthenticatedPage(page, session.token);
  await page.goto('/');
  await expectAppReady(page);

  await page.getByTitle('Create new project').click();
  await page.getByRole('button', { name: 'Existing Workspace' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByPlaceholder('/path/to/existing/workspace').fill(missingPath);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create Project' }).click();

  await expect(page.getByText('Workspace path does not exist')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create New Project' })).toBeVisible();
  expectNoUnexpectedRuntimeIssues(runtimeIssues);
});
