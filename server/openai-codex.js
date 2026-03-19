import fs from 'fs/promises';
import path from 'path';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import {
  codexAppServer,
  isInteractiveThread,
  mapPermissionModeToCodexOptions,
  sendWriterMessage,
} from './services/codex-app-server.js';

async function handleImagesForCodex(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!images || images.length === 0) {
    return { input: command, tempImagePaths, tempDir };
  }

  try {
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    const inputItems = [
      {
        type: 'text',
        text: typeof command === 'string' ? command : String(command ?? ''),
        text_elements: [],
      },
    ];

    for (const [index, image] of images.entries()) {
      const imageData = typeof image?.data === 'string' ? image.data : null;
      if (!imageData) {
        continue;
      }

      const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('[Codex] Invalid image data format');
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const extension = (mimeType.split('/')[1] || 'png').replace(/[^a-zA-Z0-9.+-]/g, '_');
      const filename = `image_${index}.${extension}`;
      const filepath = path.join(tempDir, filename);

      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
      inputItems.push({
        type: 'localImage',
        path: filepath,
      });
    }

    if (tempImagePaths.length === 0) {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
      return { input: command, tempImagePaths: [], tempDir: null };
    }

    console.log(`[Codex] Processed ${tempImagePaths.length} images to temp directory: ${tempDir}`);
    return { input: inputItems, tempImagePaths, tempDir };
  } catch (error) {
    console.error('[Codex] Error processing images:', error);
    return { input: command, tempImagePaths, tempDir };
  }
}

async function cleanupTempFiles(tempImagePaths, tempDir) {
  if ((!tempImagePaths || tempImagePaths.length === 0) && !tempDir) {
    return;
  }

  try {
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch((error) => {
        console.error(`[Codex] Failed to delete temp image ${imagePath}:`, error.message);
      });
    }

    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch((error) => {
        console.error(`[Codex] Failed to delete temp directory ${tempDir}:`, error.message);
      });
    }

    console.log(`[Codex] Cleaned up ${tempImagePaths.length} temp image files`);
  } catch (error) {
    console.error('[Codex] Error during temp file cleanup:', error);
  }
}

export async function queryCodex(command, options = {}, writer) {
  const {
    sessionId,
    sessionSummary,
    cwd,
    projectPath,
    model,
    permissionMode = 'plan',
    reasoningEffort,
    images,
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const { approvalPolicy, sandbox } = mapPermissionModeToCodexOptions(permissionMode);

  let threadId = sessionId || null;
  let completion = null;
  let turn = null;
  let tempImagePaths = [];
  let tempDir = null;

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

    const imageResult = await handleImagesForCodex(command, images, workingDirectory);
    const finalInput = imageResult.input;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    const startedTurn = await codexAppServer.startTurn(
      threadId,
      finalInput,
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
  } finally {
    await cleanupTempFiles(tempImagePaths, tempDir);
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
