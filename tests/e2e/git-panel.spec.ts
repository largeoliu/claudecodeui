import { expect, test } from '@playwright/test';
import {
  expectAppReady,
  createGitWorkspace,
  createProjectViaApi,
  ensureOnboardedUser,
  expectNoUnexpectedRuntimeIssues,
  getLatestCommitMessage,
  primeAuthenticatedPage,
  selectProject,
  trackUnexpectedRuntimeIssues,
} from './helpers/e2e';

test('user can stage and commit changes from the git panel', async ({ page, request }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page);
  const session = await ensureOnboardedUser(request);
  const repo = await createGitWorkspace('git-workspace');
  const commitMessage = 'test: commit staged changes from git panel';
  const project = await createProjectViaApi(request, session.token, 'existing', repo.dirPath);

  await primeAuthenticatedPage(page, session.token);
  await page.goto('/');
  await expectAppReady(page);

  await selectProject(page, project.project.displayName);
  await page.getByRole('button', { name: 'Source Control' }).click();

  await expect(page.getByText(repo.fileName, { exact: true })).toBeVisible();
  const firstCheckbox = page.locator('input[type="checkbox"]').first();
  await firstCheckbox.check();
  await expect(page.getByText('Staged (1)')).toBeVisible();

  await page.getByPlaceholder('Message (Ctrl+Enter to commit)').fill(commitMessage);
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();

  await expect(page.getByText('No changes detected')).toBeVisible();
  await expect.poll(() => getLatestCommitMessage(repo.dirPath)).toBe(commitMessage);
  expectNoUnexpectedRuntimeIssues(runtimeIssues);
});
