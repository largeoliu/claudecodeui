import fs from 'fs/promises';
import path from 'path';
import { expect, test } from '@playwright/test';
import {
  clearMockWebSocketMessages,
  createExistingWorkspace,
  createProjectViaApi,
  emitMockWebSocketMessage,
  ensureOnboardedUser,
  expectAppReady,
  expectNoUnexpectedRuntimeIssues,
  getMockWebSocketMessages,
  installMockWebSocket,
  primeAuthenticatedPage,
  selectProject,
  trackUnexpectedRuntimeIssues,
  waitForMockWebSocketMessage,
} from './helpers/e2e';

test('user can approve a Codex approval request via the permission banner', async ({ page, request }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page);
  const session = await ensureOnboardedUser(request);
  const workspacePath = await createExistingWorkspace('codex-approval');
  const project = await createProjectViaApi(request, session.token, 'existing', workspacePath);

  await installMockWebSocket(page);
  await primeAuthenticatedPage(page, session.token);
  await page.goto('/');
  await expectAppReady(page);

  await selectProject(page, project.project.displayName);
  await expect(page.getByRole('heading', { name: 'Choose Your AI Assistant' })).toBeVisible();

  await page.getByRole('button', { name: 'Codex Codex by OpenAI' }).click();
  await expect(page.getByText('Ready to use Codex with gpt-5.4. Start typing your message below.')).toBeVisible();

  await clearMockWebSocketMessages(page);

  await page.locator('textarea').first().fill('Write a new test file');
  await page.locator('button[type="submit"]').click();

  const sentCommand = await waitForMockWebSocketMessage(page, 'codex-command');
  expect(sentCommand).toMatchObject({
    type: 'codex-command',
    command: 'Write a new test file',
  });

  await emitMockWebSocketMessage(page, {
    type: 'session-created',
    sessionId: 'codex-approval-session-1',
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-response',
    sessionId: 'codex-approval-session-1',
    data: {
      type: 'turn_started',
    },
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-approval-request',
    sessionId: 'codex-approval-session-1',
    requestId: 'approval-req-1',
    provider: 'codex',
    requestKind: 'approval',
    toolName: 'Bash',
    input: {
      command: 'echo "hello world"',
      cwd: workspacePath,
      reason: 'Running a shell command',
      commandActions: [],
    },
    context: {},
  });

  await expect(page.getByText('需要您的授权')).toBeVisible();
  await expect(page.locator('.rounded-md').filter({ hasText: 'Bash' })).toBeVisible();

  const approvalButton = page.getByRole('button', { name: /允许单次/i });
  await expect(approvalButton).toBeVisible();
  await approvalButton.click();

  const approvalResponse = await waitForMockWebSocketMessage(page, 'codex-approval-response');
  expect(approvalResponse).toEqual({
    type: 'codex-approval-response',
    requestId: 'approval-req-1',
    allow: true,
  });

  await emitMockWebSocketMessage(page, {
    type: 'codex-interactive-response-received',
    sessionId: 'codex-approval-session-1',
    requestId: 'approval-req-1',
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-interactive-response-ack',
    sessionId: 'codex-approval-session-1',
    requestId: 'approval-req-1',
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-response',
    sessionId: 'codex-approval-session-1',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'assistant-approval-1',
      message: { content: 'Done! Created the test file.' },
    },
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-response',
    sessionId: 'codex-approval-session-1',
    data: {
      type: 'turn_complete',
    },
  });

  await expect(page.getByText('Done! Created the test file.')).toBeVisible();

  const sentMessages = await getMockWebSocketMessages(page);
  expect(sentMessages.map((m) => m.type)).toEqual(expect.arrayContaining([
    'codex-command',
    'codex-approval-response',
  ]));

  expectNoUnexpectedRuntimeIssues(runtimeIssues);
});

test('user can deny a Codex approval request', async ({ page, request }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page);
  const session = await ensureOnboardedUser(request);
  const workspacePath = await createExistingWorkspace('codex-deny');
  const project = await createProjectViaApi(request, session.token, 'existing', workspacePath);

  await installMockWebSocket(page);
  await primeAuthenticatedPage(page, session.token);
  await page.goto('/');
  await expectAppReady(page);

  await selectProject(page, project.project.displayName);
  await expect(page.getByRole('heading', { name: 'Choose Your AI Assistant' })).toBeVisible();

  await page.getByRole('button', { name: 'Codex Codex by OpenAI' }).click();
  await expect(page.getByText('Ready to use Codex with gpt-5.4. Start typing your message below.')).toBeVisible();

  await clearMockWebSocketMessages(page);

  await page.locator('textarea').first().fill('Refactor the codebase');
  await page.locator('button[type="submit"]').click();

  await waitForMockWebSocketMessage(page, 'codex-command');

  await emitMockWebSocketMessage(page, {
    type: 'session-created',
    sessionId: 'codex-deny-session-1',
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-approval-request',
    sessionId: 'codex-deny-session-1',
    requestId: 'approval-req-deny-1',
    provider: 'codex',
    requestKind: 'approval',
    toolName: 'Edit',
    input: { reason: 'Modifying multiple files', grantRoot: null },
    context: {},
  });

  await expect(page.getByText('需要您的授权')).toBeVisible();

  const denyButton = page.getByRole('button', { name: /拒绝/i });
  await expect(denyButton).toBeVisible();
  await denyButton.click();

  const approvalResponse = await waitForMockWebSocketMessage(page, 'codex-approval-response');
  expect(approvalResponse).toEqual({
    type: 'codex-approval-response',
    requestId: 'approval-req-deny-1',
    allow: false,
    message: 'User denied tool use',
  });

  expectNoUnexpectedRuntimeIssues(runtimeIssues);
});
