import { vi } from 'vitest';
import { codexAppServer } from '../../../server/services/codex-app-server.js';

function resetCodexAppServerState() {
  codexAppServer.child = null;
  codexAppServer.startPromise = null;
  codexAppServer.pendingRequests.clear();
  codexAppServer.stdoutBuffer = '';
  codexAppServer.nextRequestId = 1;
  codexAppServer.threadWriters.clear();
  codexAppServer.activeTurns.clear();
  codexAppServer.turnWaiters.clear();
  codexAppServer.loadedThreads.clear();
  codexAppServer.pendingUiRequests.clear();
  codexAppServer.pendingUiRequestsByThread.clear();
  codexAppServer.pendingUiResponseAcks.clear();
  codexAppServer.threadTokenUsage.clear();
  codexAppServer.threadCollaborationModes.clear();
  codexAppServer.threadTurnSettings.clear();
  codexAppServer.inFlightMetadataRequests.clear();
  codexAppServer.threadLoadPromises.clear();
  codexAppServer.metadataRequestQueue = Promise.resolve();
  codexAppServer.nextMetadataRequestAt = 0;
}

describe('codexAppServer interactive request lifecycle', () => {
  beforeEach(() => {
    resetCodexAppServerState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCodexAppServerState();
  });

  it('does not clear current requests when an older turn finishes', () => {
    codexAppServer.activeTurns.set('session-1', {
      threadId: 'session-1',
      turnId: 'turn-new',
      startedAt: Date.now(),
      status: 'running',
    });
    codexAppServer.storePendingUiRequest(
      {
        requestId: 'req-1',
        provider: 'codex',
        requestKind: 'approval',
        toolName: 'Bash',
        sessionId: 'session-1',
      },
      {
        method: 'item/commandExecution/requestApproval',
        threadId: 'session-1',
        turnId: 'turn-new',
      },
    );

    codexAppServer.finishTurn('session-1', { id: 'turn-old', status: 'completed' });

    expect(codexAppServer.activeTurns.get('session-1')).toEqual(
      expect.objectContaining({ turnId: 'turn-new' }),
    );
    expect(codexAppServer.pendingUiRequests.has('req-1')).toBe(true);
    expect(codexAppServer.pendingUiRequestsByThread.get('session-1')?.has('req-1')).toBe(true);
  });

  it('removes resolved approvals without broadcasting cancellation', async () => {
    const sendResponseSpy = vi.spyOn(codexAppServer, 'sendResponse').mockImplementation(() => {});
    const broadcastSpy = vi.spyOn(codexAppServer, 'broadcastToThread').mockImplementation(() => {});

    codexAppServer.storePendingUiRequest(
      {
        requestId: 'req-1',
        provider: 'codex',
        requestKind: 'approval',
        toolName: 'Bash',
        sessionId: 'session-1',
      },
      {
        method: 'item/commandExecution/requestApproval',
        threadId: 'session-1',
        turnId: 'turn-1',
      },
    );

    const result = await codexAppServer.respondToApproval('req-1', { allow: true });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        requestId: 'req-1',
        sessionId: 'session-1',
        requestKind: 'approval',
      }),
    );
    expect(sendResponseSpy).toHaveBeenCalledWith('req-1', { decision: 'accept' });
    expect(codexAppServer.pendingUiRequests.has('req-1')).toBe(false);
    expect(codexAppServer.pendingUiRequestsByThread.get('session-1')).toBeUndefined();
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('preserves numeric request ids for user-input responses', async () => {
    const sendResponseSpy = vi.spyOn(codexAppServer, 'sendResponse').mockImplementation(() => {});
    vi.spyOn(codexAppServer, 'broadcastToThread').mockImplementation(() => {});

    await codexAppServer.handleServerRequest({
      id: 42,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'session-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        questions: [
          {
            id: 'strategy',
            header: 'Support strategy',
            question: 'Which strategy should we use?',
            options: [{ label: 'Strict', description: 'Use the strict option.' }],
          },
        ],
      },
    });

    const result = await codexAppServer.respondToUserInput('42', {
      strategy: 'Strict',
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        requestId: '42',
        sessionId: 'session-1',
        requestKind: 'user-input',
      }),
    );
    expect(sendResponseSpy).toHaveBeenCalledWith(42, {
      answers: {
        strategy: { answers: ['Strict'] },
      },
    });
    expect(codexAppServer.pendingUiResponseAcks.has('42')).toBe(true);
  });

  it('dedupes concurrent metadata reads for the same thread', async () => {
    const sendRequestSpy = vi.spyOn(codexAppServer, 'sendRequest').mockResolvedValue({
      thread: {
        id: 'session-1',
        source: 'cli',
      },
    });

    const [first, second] = await Promise.all([
      codexAppServer.readThread('session-1', true),
      codexAppServer.readThread('session-1', true),
    ]);

    expect(sendRequestSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('retries transient metadata failures before succeeding', async () => {
    const sendRequestSpy = vi.spyOn(codexAppServer, 'sendRequest')
      .mockRejectedValueOnce({ code: -32001, message: 'Server overloaded; retry later.' })
      .mockResolvedValueOnce({
        thread: {
          id: 'session-1',
          source: 'cli',
        },
      });

    const thread = await codexAppServer.readThread('session-1', true);

    expect(sendRequestSpy).toHaveBeenCalledTimes(2);
    expect(thread).toEqual({ id: 'session-1', source: 'cli' });
  });

  it('dedupes concurrent thread loading', async () => {
    const resumeThreadSpy = vi.spyOn(codexAppServer, 'resumeThread').mockImplementation(async (threadId) => {
      codexAppServer.loadedThreads.add(threadId);
      return { thread: { id: threadId } };
    });

    await Promise.all([
      codexAppServer.ensureThreadLoaded('session-1'),
      codexAppServer.ensureThreadLoaded('session-1'),
    ]);

    expect(resumeThreadSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves numeric request ids for approval responses', async () => {
    const sendResponseSpy = vi.spyOn(codexAppServer, 'sendResponse').mockImplementation(() => {});
    vi.spyOn(codexAppServer, 'broadcastToThread').mockImplementation(() => {});

    await codexAppServer.handleServerRequest({
      id: 43,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'session-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        command: 'npm test',
        cwd: '/opt/claudecodeui',
      },
    });

    const result = await codexAppServer.respondToApproval('43', { allow: true });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        requestId: '43',
        sessionId: 'session-1',
        requestKind: 'approval',
      }),
    );
    expect(sendResponseSpy).toHaveBeenCalledWith(43, { decision: 'accept' });
    expect(codexAppServer.pendingUiResponseAcks.has('43')).toBe(true);
  });

  it('keeps string request ids unchanged for user-input responses', async () => {
    const sendResponseSpy = vi.spyOn(codexAppServer, 'sendResponse').mockImplementation(() => {});
    vi.spyOn(codexAppServer, 'broadcastToThread').mockImplementation(() => {});

    await codexAppServer.handleServerRequest({
      id: 'req-user-1',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'session-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        questions: [
          {
            id: 'strategy',
            header: 'Support strategy',
            question: 'Which strategy should we use?',
            options: [{ label: 'Strict', description: 'Use the strict option.' }],
          },
        ],
      },
    });

    await codexAppServer.respondToUserInput('req-user-1', {
      strategy: 'Strict',
    });

    expect(sendResponseSpy).toHaveBeenCalledWith('req-user-1', {
      answers: {
        strategy: { answers: ['Strict'] },
      },
    });
  });

  it('broadcasts interactive ack only after server request resolution is observed', async () => {
    const broadcastSpy = vi.spyOn(codexAppServer, 'broadcastToThread').mockImplementation(() => {});
    vi.spyOn(codexAppServer, 'sendResponse').mockImplementation(() => {});

    await codexAppServer.handleServerRequest({
      id: 44,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'session-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        questions: [
          {
            id: 'strategy',
            header: 'Support strategy',
            question: 'Which strategy should we use?',
            options: [{ label: 'Strict', description: 'Use the strict option.' }],
          },
        ],
      },
    });

    await codexAppServer.respondToUserInput('44', {
      strategy: 'Strict',
    });

    expect(
      broadcastSpy.mock.calls.some(([, payload]) => payload?.type === 'codex-interactive-response-ack'),
    ).toBe(false);

    codexAppServer.handleNotification({
      method: 'serverRequest/resolved',
      params: {
        threadId: 'session-1',
        requestId: 44,
      },
    });

    expect(broadcastSpy).toHaveBeenCalledWith('session-1', {
      type: 'codex-interactive-response-ack',
      requestId: '44',
      sessionId: 'session-1',
      requestKind: 'user-input',
      toolName: 'AskUserQuestion',
    });
    expect(codexAppServer.pendingUiResponseAcks.has('44')).toBe(false);
  });

  it('falls back to turn progress notifications for interactive ack confirmation', async () => {
    const broadcastSpy = vi.spyOn(codexAppServer, 'broadcastToThread').mockImplementation(() => {});
    vi.spyOn(codexAppServer, 'sendResponse').mockImplementation(() => {});

    await codexAppServer.handleServerRequest({
      id: 45,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'session-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        command: 'npm test',
        cwd: '/opt/claudecodeui',
      },
    });

    await codexAppServer.respondToApproval('45', { allow: true });

    codexAppServer.handleNotification({
      method: 'item/completed',
      params: {
        threadId: 'session-1',
        turnId: 'turn-1',
        item: {
          id: 'item-2',
          type: 'agentMessage',
          text: 'done',
        },
      },
    });

    expect(broadcastSpy).toHaveBeenCalledWith('session-1', {
      type: 'codex-interactive-response-ack',
      requestId: '45',
      sessionId: 'session-1',
      requestKind: 'approval',
      toolName: 'Bash',
    });
    expect(codexAppServer.pendingUiResponseAcks.has('45')).toBe(false);
  });

  it('still broadcasts cancellation when pending requests are cleared for teardown', () => {
    const broadcastSpy = vi.spyOn(codexAppServer, 'broadcastToThread').mockImplementation(() => {});

    codexAppServer.storePendingUiRequest(
      {
        requestId: 'req-1',
        provider: 'codex',
        requestKind: 'approval',
        toolName: 'Bash',
        sessionId: 'session-1',
      },
      {
        method: 'item/commandExecution/requestApproval',
        threadId: 'session-1',
        turnId: 'turn-1',
      },
    );

    codexAppServer.clearPendingUiRequests('session-1');

    expect(codexAppServer.pendingUiRequests.size).toBe(0);
    expect(codexAppServer.pendingUiRequestsByThread.size).toBe(0);
    expect(broadcastSpy).toHaveBeenCalledWith('session-1', {
      type: 'codex-request-cancelled',
      sessionId: 'session-1',
      requestId: 'req-1',
    });
  });
});

describe('codexAppServer reasoning effort coercion', () => {
  beforeEach(() => {
    resetCodexAppServerState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCodexAppServerState();
  });

  it('drops unsupported high reasoning effort before sending the turn request', async () => {
    vi.spyOn(codexAppServer, 'ensureThreadLoaded').mockResolvedValue();
    const sendRequestSpy = vi.spyOn(codexAppServer, 'sendRequest').mockResolvedValue({ ok: true });

    await codexAppServer.startTurn('session-1', 'hello', {
      model: 'o4-mini',
      reasoningEffort: 'high',
    });

    expect(sendRequestSpy).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      model: 'o4-mini',
      effort: 'medium',
    }));
  });

  it('passes through xhigh reasoning effort for supported models', async () => {
    vi.spyOn(codexAppServer, 'ensureThreadLoaded').mockResolvedValue();
    const sendRequestSpy = vi.spyOn(codexAppServer, 'sendRequest').mockResolvedValue({ ok: true });

    await codexAppServer.startTurn('session-1', 'hello', {
      model: 'gpt-5.2',
      reasoningEffort: 'xhigh',
    });

    expect(sendRequestSpy).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      model: 'gpt-5.2',
      effort: 'xhigh',
    }));
  });

  it('tracks coerced reasoning effort for per-thread settings comparisons', () => {
    codexAppServer.setTrackedTurnSettings('session-1', {
      model: 'o4-mini',
      reasoningEffort: 'high',
    });

    expect(codexAppServer.getTrackedTurnSettings('session-1')).toEqual({
      model: 'o4-mini',
      reasoningEffort: 'medium',
    });
  });
});
