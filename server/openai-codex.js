import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import {
  codexAppServer,
  isInteractiveThread,
  mapPermissionModeToCodexOptions,
  sendWriterMessage,
} from './services/codex-app-server.js';

export async function queryCodex(command, options = {}, writer) {
  const {
    sessionId,
    sessionSummary,
    cwd,
    projectPath,
    model,
    permissionMode = 'plan',
    reasoningEffort,
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const { approvalPolicy, sandbox } = mapPermissionModeToCodexOptions(permissionMode);

  let threadId = sessionId || null;
  let completion = null;
  let turn = null;

  try {
    if (sessionId) {
      await codexAppServer.resumeThread(sessionId, {
        cwd: workingDirectory,
        approvalPolicy,
        sandbox,
        model,
      });
      threadId = sessionId;
    } else {
      const started = await codexAppServer.startThread({
        cwd: workingDirectory,
        approvalPolicy,
        sandbox,
        model,
      });
      threadId = started?.thread?.id || null;
      if (!threadId) {
        throw new Error('Codex app-server did not return a thread id');
      }
      sendWriterMessage(writer, {
        type: 'session-created',
        sessionId: threadId,
        provider: 'codex',
      });
    }

    if (!threadId) {
      throw new Error('Missing Codex thread id');
    }

    if (typeof writer?.setSessionId === 'function') {
      writer.setSessionId(threadId);
    }

    const startedTurn = await codexAppServer.startTurn(
      threadId,
      command,
      {
        cwd: workingDirectory,
        approvalPolicy,
        model,
        reasoningEffort,
      },
      writer,
    );

    turn = startedTurn.turn;
    completion = startedTurn.completion;

    const completedTurn = await completion;
    const stopReason = completedTurn?.status === 'interrupted' ? 'interrupted' : 'completed';

    if (completedTurn?.status !== 'interrupted') {
      sendWriterMessage(writer, {
        type: 'codex-complete',
        sessionId: threadId,
        actualSessionId: threadId,
        provider: 'codex',
      });
    }

    notifyRunStopped({
      userId: writer?.userId || null,
      provider: 'codex',
      sessionId: threadId,
      sessionName: sessionSummary,
      stopReason,
    });

    return completedTurn;
  } catch (error) {
    const message = error?.message || 'Unknown Codex error';
    const wasAborted = /aborted|interrupted/i.test(message);

    if (!wasAborted) {
      console.error('[Codex] Error:', error);
      sendWriterMessage(writer, {
        type: 'codex-error',
        error: message,
        sessionId: threadId,
        provider: 'codex',
      });
      notifyRunFailed({
        userId: writer?.userId || null,
        provider: 'codex',
        sessionId: threadId,
        sessionName: sessionSummary,
        error,
      });
    }

    throw error;
  }
}

export function abortCodexSession(sessionId) {
  if (!codexAppServer.isThreadActive(sessionId)) {
    return false;
  }

  codexAppServer.interruptTurn(sessionId).catch((error) => {
    console.warn(`[Codex] Failed to interrupt session ${sessionId}:`, error.message);
  });

  return true;
}

export function isCodexSessionActive(sessionId) {
  return codexAppServer.isThreadActive(sessionId);
}

export function getActiveCodexSessions() {
  return codexAppServer.getActiveThreads();
}

export function reconnectCodexSessionWriter(sessionId, writer) {
  codexAppServer.reconnectWriter(sessionId, writer);
}

export function getPendingCodexRequests(sessionId) {
  return codexAppServer.getPendingRequests(sessionId);
}

export async function respondToCodexApproval(requestId, decision = {}) {
  return codexAppServer.respondToApproval(requestId, decision);
}

export async function respondToCodexUserInput(requestId, answers = {}) {
  return codexAppServer.respondToUserInput(requestId, answers);
}

export async function respondToCodexCommandStdin(requestId, text = '') {
  return codexAppServer.respondToTerminalInput(requestId, text);
}

export async function listCodexThreads(options = {}) {
  const result = await codexAppServer.listThreads(options);
  result.data = (result.data || []).filter(isInteractiveThread);
  return result;
}

export async function readCodexThread(threadId, includeTurns = true) {
  return codexAppServer.resolveInteractiveThread(threadId, includeTurns);
}

export async function deleteCodexThreadHard(threadId) {
  return codexAppServer.deleteThreadHard(threadId);
}

export function getCodexThreadTokenUsage(threadId) {
  return codexAppServer.getThreadTokenUsage(threadId);
}
