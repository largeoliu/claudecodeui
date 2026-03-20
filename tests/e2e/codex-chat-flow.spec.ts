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

test('user can complete a controlled Codex chat turn with interactive requests', async ({ page, request }) => {
  const runtimeIssues = trackUnexpectedRuntimeIssues(page);
  const session = await ensureOnboardedUser(request);
  const workspacePath = await createExistingWorkspace('codex-chat');
  await fs.writeFile(path.join(workspacePath, 'failing.test.js'), 'test("fails", () => expect(true).toBe(false));\n', 'utf8');
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

  await page.locator('textarea').first().fill('Explain why the test fails');
  await page.locator('button[type="submit"]').click();

  const sentCommand = await waitForMockWebSocketMessage(page, 'codex-command');
  expect(sentCommand).toMatchObject({
    type: 'codex-command',
    command: 'Explain why the test fails',
    options: {
      model: 'gpt-5.4',
      projectPath: workspacePath,
      cwd: workspacePath,
      resume: false,
      reasoningEffort: 'medium',
      interactionMode: 'edit',
      approvalPolicy: 'on-request',
    },
  });

  await expect(page.getByText('Explain why the test fails', { exact: true })).toBeVisible();

  await emitMockWebSocketMessage(page, {
    type: 'session-created',
    sessionId: 'codex-session-1',
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-response',
    sessionId: 'codex-session-1',
    data: {
      type: 'turn_started',
    },
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-response',
    sessionId: 'codex-session-1',
    data: {
      type: 'item',
      itemType: 'reasoning_delta',
      itemId: 'thinking-1',
      delta: 'Reviewing the repo',
    },
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-response',
    sessionId: 'codex-session-1',
    data: {
      type: 'item',
      itemType: 'command_execution',
      itemId: 'command-1',
      command: 'npm test',
      cwd: workspacePath,
      exitCode: null,
    },
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-response',
    sessionId: 'codex-session-1',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'assistant-1',
      message: {
        content: 'The failure is intentional: the assertion expects true to equal false.',
      },
    },
  });

  await expect(page.getByText('npm test')).toBeVisible();
  await expect(page.getByText('The failure is intentional: the assertion expects true to equal false.')).toBeVisible();

  await emitMockWebSocketMessage(page, {
    type: 'codex-user-input-request',
    sessionId: 'codex-session-1',
    requestId: 'req-question-1',
    toolName: 'AskUserQuestion',
    input: {
      questions: [
        {
          id: 'strategy',
          header: 'Test strategy',
          question: 'How should Codex proceed?',
          options: [
            { label: 'Explain only', description: 'Summarize the issue without changing code.' },
            { label: 'Patch it', description: 'Prepare a code fix.' },
          ],
        },
      ],
    },
  });

  await expect(page.getByText('Agent needs your input')).toBeVisible();
  await page.getByRole('button', { name: /Explain only/i }).click();
  await page.getByRole('button', { name: /Submit/i }).click();

  const userInputResponse = await waitForMockWebSocketMessage(page, 'codex-user-input-response');
  expect(userInputResponse).toEqual({
    type: 'codex-user-input-response',
    requestId: 'req-question-1',
    answers: {
      strategy: 'Explain only',
    },
  });

  await emitMockWebSocketMessage(page, {
    type: 'codex-interactive-response-received',
    sessionId: 'codex-session-1',
    requestId: 'req-question-1',
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-interactive-response-ack',
    sessionId: 'codex-session-1',
    requestId: 'req-question-1',
  });
  await expect(page.getByText('Agent needs your input')).toBeHidden();

  await emitMockWebSocketMessage(page, {
    type: 'codex-command-stdin-request',
    sessionId: 'codex-session-1',
    requestId: 'req-stdin-1',
    toolName: 'CodexTerminalInput',
    input: {
      prompt: 'Provide stdin for the command',
      observedStdin: 'npm test\n',
      processId: 'proc-1',
    },
  });

  await expect(page.getByText('Terminal input required')).toBeVisible();
  await page.getByPlaceholder('Type the text to send to the terminal').fill('n');
  await page.getByRole('button', { name: 'Send input' }).click();

  const stdinResponse = await waitForMockWebSocketMessage(page, 'codex-command-stdin-response');
  expect(stdinResponse).toEqual({
    type: 'codex-command-stdin-response',
    requestId: 'req-stdin-1',
    text: 'n',
  });

  await emitMockWebSocketMessage(page, {
    type: 'codex-interactive-response-received',
    sessionId: 'codex-session-1',
    requestId: 'req-stdin-1',
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-interactive-response-ack',
    sessionId: 'codex-session-1',
    requestId: 'req-stdin-1',
  });
  await emitMockWebSocketMessage(page, {
    type: 'codex-response',
    sessionId: 'codex-session-1',
    data: {
      type: 'turn_complete',
    },
  });

  await expect(page.getByText('Terminal input required')).toBeHidden();

  const sentMessages = await getMockWebSocketMessages(page);
  expect(sentMessages.map((message) => message.type)).toEqual(expect.arrayContaining([
    'codex-command',
    'codex-user-input-response',
    'codex-command-stdin-response',
  ]));

  expectNoUnexpectedRuntimeIssues(runtimeIssues);
});
