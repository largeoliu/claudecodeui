import fs from 'fs/promises';
import path from 'path';
import { vi } from 'vitest';
import { CODEX_MISSING_FINAL_SUMMARY_MESSAGE } from '../../../shared/codexCompletion.js';
import { withServerTestEnv } from '../../helpers/server-test-env.js';

const codexMocks = vi.hoisted(() => ({
  deleteCodexThreadHard: vi.fn(),
  getCodexThreadTokenUsage: vi.fn(),
  listCodexThreads: vi.fn(),
  readCodexThread: vi.fn(),
}));

vi.mock('../../../server/openai-codex.js', () => ({
  deleteCodexThreadHard: codexMocks.deleteCodexThreadHard,
  getCodexThreadTokenUsage: codexMocks.getCodexThreadTokenUsage,
  listCodexThreads: codexMocks.listCodexThreads,
  readCodexThread: codexMocks.readCodexThread,
}));

describe('Codex session message loading', () => {
  beforeEach(() => {
    codexMocks.deleteCodexThreadHard.mockReset();
    codexMocks.getCodexThreadTokenUsage.mockReset();
    codexMocks.listCodexThreads.mockReset();
    codexMocks.readCodexThread.mockReset();
    codexMocks.getCodexThreadTokenUsage.mockReturnValue(null);
    codexMocks.listCodexThreads.mockResolvedValue({ data: [] });
  });

  it('keeps long-turn assistant messages on their real rollout timestamps', async () => {
    await withServerTestEnv(async ({ tempDir, importServerModule }) => {
      const rolloutPath = path.join(tempDir, 'codex-rollout.jsonl');
      await fs.writeFile(rolloutPath, [
        JSON.stringify({
          timestamp: '2026-03-20T02:50:22.376Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-1' },
        }),
        JSON.stringify({
          timestamp: '2026-03-20T02:50:22.377Z',
          type: 'event_msg',
          payload: { type: 'user_message', kind: 'plain', message: '继续' },
        }),
        JSON.stringify({
          timestamp: '2026-03-20T02:50:40.382Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: '我先看相关文件。' },
        }),
        JSON.stringify({
          timestamp: '2026-03-20T02:53:08.350Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: '我现在改状态层。' },
        }),
        JSON.stringify({
          timestamp: '2026-03-20T03:07:25.336Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: '测试部分已经通过。' },
        }),
      ].join('\n'), 'utf8');

      codexMocks.readCodexThread.mockResolvedValue({
        createdAt: Date.parse('2026-03-20T02:50:22.376Z') / 1000,
        path: rolloutPath,
        turns: [
          {
            id: 'turn-1',
            items: [
              {
                type: 'userMessage',
                content: [{ type: 'text', text: '继续' }],
              },
              { type: 'agentMessage', text: '我先看相关文件。' },
              { type: 'agentMessage', text: '我现在改状态层。' },
              { type: 'agentMessage', text: '测试部分已经通过。' },
            ],
          },
        ],
      });

      const { getCodexSessionMessages } = await importServerModule('../../server/projects.js');
      const result = await getCodexSessionMessages('session-1', 2, 0);

      expect(result.total).toBe(4);
      expect(result.messages).toHaveLength(2);
      expect(result.messages.map((message) => message.timestamp)).toEqual([
        '2026-03-20T02:53:08.350Z',
        '2026-03-20T03:07:25.336Z',
      ]);
      expect(result.messages.map((message) => message.message?.content)).toEqual([
        '我现在改状态层。',
        '测试部分已经通过。',
      ]);
    });
  });

  it('adds a completion notice when Codex finishes without a final summary', async () => {
    await withServerTestEnv(async ({ tempDir, importServerModule }) => {
      const rolloutPath = path.join(tempDir, 'codex-rollout-missing-final.jsonl');
      await fs.writeFile(rolloutPath, [
        JSON.stringify({
          timestamp: '2026-03-20T14:29:49.100Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-1' },
        }),
        JSON.stringify({
          timestamp: '2026-03-20T14:29:49.200Z',
          type: 'event_msg',
          payload: { type: 'user_message', kind: 'plain', message: '继续排查。' },
        }),
        JSON.stringify({
          timestamp: '2026-03-20T14:29:50.948Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: '我再看后端分页语义，确认 offset 方向。' },
        }),
        JSON.stringify({
          timestamp: '2026-03-20T14:29:53.440Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: 'turn-1', last_agent_message: null },
        }),
      ].join('\n'), 'utf8');

      codexMocks.readCodexThread.mockResolvedValue({
        createdAt: Date.parse('2026-03-20T14:29:49.100Z') / 1000,
        path: rolloutPath,
        turns: [
          {
            id: 'turn-1',
            items: [
              {
                type: 'userMessage',
                content: [{ type: 'text', text: '继续排查。' }],
              },
              { type: 'agentMessage', text: '我再看后端分页语义，确认 offset 方向。' },
            ],
          },
        ],
      });

      const { getCodexSessionMessages } = await importServerModule('../../server/projects.js');
      const result = await getCodexSessionMessages('session-2');

      expect(result.messages.map((message) => message.message?.content)).toEqual([
        '继续排查。',
        '我再看后端分页语义，确认 offset 方向。',
        CODEX_MISSING_FINAL_SUMMARY_MESSAGE,
      ]);
      expect(result.messages[2]?.timestamp).toBe('2026-03-20T14:29:53.440Z');
    });
  });
});
