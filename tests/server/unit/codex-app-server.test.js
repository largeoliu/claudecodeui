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
  codexAppServer.threadTokenUsage.clear();
  codexAppServer.threadCollaborationModes.clear();
  codexAppServer.threadTurnSettings.clear();
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
