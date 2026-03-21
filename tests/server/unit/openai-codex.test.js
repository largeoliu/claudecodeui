import { vi } from 'vitest';

const codexMocks = vi.hoisted(() => {
  const codexAppServer = {
    resumeThread: vi.fn(),
    startThread: vi.fn(),
    shouldSyncCollaborationMode: vi.fn(),
    shouldSyncTurnSettings: vi.fn(),
    startTurn: vi.fn(),
    resolveInteractiveThread: vi.fn(),
    setTrackedCollaborationMode: vi.fn(),
    updateTrackedTurnSettings: vi.fn(),
    isThreadActive: vi.fn(),
    interruptTurn: vi.fn(),
    getActiveThreads: vi.fn(),
    reconnectWriter: vi.fn(),
    getPendingRequests: vi.fn(),
  };

  return {
    fs: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      unlink: vi.fn(),
      rm: vi.fn(),
    },
    codexAppServer,
    getCodexThreadOptions: vi.fn(),
    isInteractiveThread: vi.fn((thread) => Boolean(thread)),
    normalizeReasoningEffort: vi.fn((value) => `normalized-${value ?? 'medium'}`),
    sendWriterMessage: vi.fn(),
    notifyRunFailed: vi.fn(),
    notifyRunStopped: vi.fn(),
    extractCodexTurnCompletionStatesFromRollout: vi.fn(),
  };
});

vi.mock('fs/promises', () => ({
  default: codexMocks.fs,
  mkdir: codexMocks.fs.mkdir,
  writeFile: codexMocks.fs.writeFile,
  unlink: codexMocks.fs.unlink,
  rm: codexMocks.fs.rm,
}));

vi.mock('../../../server/services/codex-app-server.js', () => ({
  codexAppServer: codexMocks.codexAppServer,
  getCodexThreadOptions: codexMocks.getCodexThreadOptions,
  isInteractiveThread: codexMocks.isInteractiveThread,
  normalizeReasoningEffort: codexMocks.normalizeReasoningEffort,
  sendWriterMessage: codexMocks.sendWriterMessage,
}));

vi.mock('../../../server/services/notification-orchestrator.js', () => ({
  notifyRunFailed: codexMocks.notifyRunFailed,
  notifyRunStopped: codexMocks.notifyRunStopped,
}));

vi.mock('../../../server/services/codex-rollout.js', () => ({
  extractCodexTurnCompletionStatesFromRollout: codexMocks.extractCodexTurnCompletionStatesFromRollout,
}));

import { abortCodexSession, queryCodex } from '../../../server/openai-codex.js';

describe('openai-codex', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    codexMocks.fs.mkdir.mockReset();
    codexMocks.fs.writeFile.mockReset();
    codexMocks.fs.unlink.mockReset();
    codexMocks.fs.rm.mockReset();

    codexMocks.codexAppServer.resumeThread.mockReset();
    codexMocks.codexAppServer.startThread.mockReset();
    codexMocks.codexAppServer.shouldSyncCollaborationMode.mockReset();
    codexMocks.codexAppServer.shouldSyncTurnSettings.mockReset();
    codexMocks.codexAppServer.startTurn.mockReset();
    codexMocks.codexAppServer.resolveInteractiveThread.mockReset();
    codexMocks.codexAppServer.setTrackedCollaborationMode.mockReset();
    codexMocks.codexAppServer.updateTrackedTurnSettings.mockReset();
    codexMocks.codexAppServer.isThreadActive.mockReset();
    codexMocks.codexAppServer.interruptTurn.mockReset();
    codexMocks.codexAppServer.getActiveThreads.mockReset();
    codexMocks.codexAppServer.reconnectWriter.mockReset();
    codexMocks.codexAppServer.getPendingRequests.mockReset();

    codexMocks.getCodexThreadOptions.mockReset();
    codexMocks.isInteractiveThread.mockReset();
    codexMocks.normalizeReasoningEffort.mockReset();
    codexMocks.sendWriterMessage.mockReset();
    codexMocks.notifyRunFailed.mockReset();
    codexMocks.notifyRunStopped.mockReset();
    codexMocks.extractCodexTurnCompletionStatesFromRollout.mockReset();

    codexMocks.fs.mkdir.mockResolvedValue(undefined);
    codexMocks.fs.writeFile.mockResolvedValue(undefined);
    codexMocks.fs.unlink.mockResolvedValue(undefined);
    codexMocks.fs.rm.mockResolvedValue(undefined);

    codexMocks.getCodexThreadOptions.mockReturnValue({
      approvalPolicy: 'resolved-approval',
      sandbox: 'workspace-write',
    });
    codexMocks.isInteractiveThread.mockImplementation((thread) => Boolean(thread));
    codexMocks.normalizeReasoningEffort.mockImplementation((value) => `normalized-${value ?? 'medium'}`);
    codexMocks.codexAppServer.startThread.mockResolvedValue({ thread: { id: 'thread-1' } });
    codexMocks.codexAppServer.resumeThread.mockResolvedValue(undefined);
    codexMocks.codexAppServer.shouldSyncCollaborationMode.mockReturnValue(true);
    codexMocks.codexAppServer.shouldSyncTurnSettings.mockReturnValue({ model: true, reasoningEffort: true });
    codexMocks.codexAppServer.startTurn.mockResolvedValue({
      turn: { id: 'turn-1' },
      completion: Promise.resolve({ status: 'completed' }),
    });
    codexMocks.codexAppServer.resolveInteractiveThread.mockResolvedValue({ path: '/root/.codex/sessions/mock.jsonl' });
    codexMocks.codexAppServer.isThreadActive.mockReturnValue(false);
    codexMocks.codexAppServer.interruptTurn.mockResolvedValue(undefined);
    codexMocks.extractCodexTurnCompletionStatesFromRollout.mockResolvedValue(new Map());
  });

  it('starts a new Codex thread, syncs settings, and cleans up temp images', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000_000);
    const writer = {
      userId: 'user-1',
      setSessionId: vi.fn(),
    };

    const result = await queryCodex(
      'Inspect the screenshot',
      {
        cwd: '/work/demo-project',
        model: 'gpt-5-codex',
        interactionMode: 'plan',
        approvalPolicy: 'never',
        reasoningEffort: 'high',
        sessionSummary: 'Screenshot review',
        images: [{ data: 'data:image/png;base64,aGVsbG8=' }],
      },
      writer,
    );

    expect(result).toEqual({ status: 'completed' });
    expect(codexMocks.codexAppServer.startThread).toHaveBeenCalledWith({
      cwd: '/work/demo-project',
      approvalPolicy: 'resolved-approval',
      sandbox: 'workspace-write',
      model: 'gpt-5-codex',
    });
    expect(codexMocks.fs.mkdir).toHaveBeenCalledWith('/work/demo-project/.tmp/images/1710000000000', {
      recursive: true,
    });
    expect(codexMocks.fs.writeFile).toHaveBeenCalledWith(
      '/work/demo-project/.tmp/images/1710000000000/image_0.png',
      expect.any(Buffer),
    );
    expect(codexMocks.codexAppServer.startTurn).toHaveBeenCalledWith(
      'thread-1',
      [
        expect.objectContaining({
          type: 'text',
          text: 'Inspect the screenshot',
        }),
        {
          type: 'localImage',
          path: '/work/demo-project/.tmp/images/1710000000000/image_0.png',
        },
      ],
      {
        cwd: '/work/demo-project',
        approvalPolicy: 'resolved-approval',
        model: 'gpt-5-codex',
        reasoningEffort: 'high',
        collaborationMode: {
          mode: 'plan',
          settings: {
            model: 'gpt-5-codex',
            reasoning_effort: 'normalized-high',
            developer_instructions: null,
          },
        },
      },
      writer,
    );
    expect(writer.setSessionId).toHaveBeenCalledWith('thread-1');
    expect(codexMocks.sendWriterMessage).toHaveBeenNthCalledWith(1, writer, {
      type: 'session-created',
      sessionId: 'thread-1',
      provider: 'codex',
    });
    expect(codexMocks.sendWriterMessage).toHaveBeenNthCalledWith(2, writer, {
      type: 'codex-complete',
      sessionId: 'thread-1',
      actualSessionId: 'thread-1',
      provider: 'codex',
      lastAgentMessage: null,
      missingFinalSummary: false,
    });
    expect(codexMocks.codexAppServer.updateTrackedTurnSettings).toHaveBeenCalledWith('thread-1', {
      model: 'gpt-5-codex',
      reasoningEffort: 'high',
    });
    expect(codexMocks.codexAppServer.setTrackedCollaborationMode).toHaveBeenCalledWith('thread-1', 'plan');
    expect(codexMocks.notifyRunStopped).toHaveBeenCalledWith({
      userId: 'user-1',
      provider: 'codex',
      sessionId: 'thread-1',
      sessionName: 'Screenshot review',
      stopReason: 'completed',
    });
    expect(codexMocks.fs.unlink).toHaveBeenCalledWith('/work/demo-project/.tmp/images/1710000000000/image_0.png');
    expect(codexMocks.fs.rm).toHaveBeenCalledWith('/work/demo-project/.tmp/images/1710000000000', {
      recursive: true,
      force: true,
    });
  });

  it('resumes existing Codex threads and suppresses completion broadcasts for interrupted runs', async () => {
    codexMocks.codexAppServer.shouldSyncCollaborationMode.mockReturnValue(false);
    codexMocks.codexAppServer.shouldSyncTurnSettings.mockReturnValue({ model: false, reasoningEffort: false });
    codexMocks.codexAppServer.startTurn.mockResolvedValue({
      turn: { id: 'turn-9' },
      completion: Promise.resolve({ status: 'interrupted' }),
    });

    const writer = { userId: 'user-2' };
    const result = await queryCodex(
      'Continue',
      {
        sessionId: 'thread-9',
        cwd: '/work/demo-project',
        model: 'gpt-5-codex',
        sessionSummary: 'Resume flow',
      },
      writer,
    );

    expect(result).toEqual({ status: 'interrupted' });
    expect(codexMocks.codexAppServer.resumeThread).toHaveBeenCalledWith('thread-9', {
      cwd: '/work/demo-project',
      approvalPolicy: 'resolved-approval',
      sandbox: 'workspace-write',
    });
    expect(codexMocks.sendWriterMessage).not.toHaveBeenCalled();
    expect(codexMocks.notifyRunStopped).toHaveBeenCalledWith({
      userId: 'user-2',
      provider: 'codex',
      sessionId: 'thread-9',
      sessionName: 'Resume flow',
      stopReason: 'interrupted',
    });
  });

  it('includes rollout completion metadata in the final Codex completion event', async () => {
    codexMocks.extractCodexTurnCompletionStatesFromRollout.mockResolvedValue(new Map([
      ['turn-1', {
        completionTimestamp: '2026-03-20T14:29:53.440Z',
        hasTaskComplete: true,
        lastAgentMessage: null,
        missingFinalSummary: true,
      }],
    ]));

    await queryCodex(
      'Inspect the bug',
      {
        cwd: '/work/demo-project',
        model: 'gpt-5-codex',
        sessionSummary: 'Bug investigation',
      },
      { userId: 'user-3', setSessionId: vi.fn() },
    );

    expect(codexMocks.sendWriterMessage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'codex-complete',
        sessionId: 'thread-1',
        lastAgentMessage: null,
        missingFinalSummary: true,
      }),
    );
  });

  it('surfaces Codex errors to the writer and failure notifications', async () => {
    const failure = new Error('Codex exploded');
    codexMocks.codexAppServer.startTurn.mockResolvedValue({
      turn: { id: 'turn-2' },
      completion: Promise.reject(failure),
    });

    const writer = { userId: 'user-3' };

    await expect(queryCodex('Break it', {
      cwd: '/work/demo-project',
      model: 'gpt-5-codex',
      sessionSummary: 'Failure path',
    }, writer)).rejects.toThrow('Codex exploded');

    expect(codexMocks.sendWriterMessage).toHaveBeenNthCalledWith(1, writer, {
      type: 'session-created',
      sessionId: 'thread-1',
      provider: 'codex',
    });
    expect(codexMocks.sendWriterMessage).toHaveBeenNthCalledWith(2, writer, {
      type: 'codex-error',
      error: 'Codex exploded',
      sessionId: 'thread-1',
      provider: 'codex',
    });
    expect(codexMocks.notifyRunFailed).toHaveBeenCalledWith({
      userId: 'user-3',
      provider: 'codex',
      sessionId: 'thread-1',
      sessionName: 'Failure path',
      error: failure,
    });
  });

  it('interrupts active Codex sessions and skips inactive ones', () => {
    codexMocks.codexAppServer.isThreadActive
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    expect(abortCodexSession('thread-idle')).toBe(false);
    expect(codexMocks.codexAppServer.interruptTurn).not.toHaveBeenCalled();

    expect(abortCodexSession('thread-active')).toBe(true);
    expect(codexMocks.codexAppServer.interruptTurn).toHaveBeenCalledWith('thread-active');
  });
});
