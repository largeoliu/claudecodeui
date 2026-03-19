import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';

const REQUEST_TIMEOUT_MS = 30000;
const CODEX_APP_SERVER_ARGS = ['app-server', '--listen', 'stdio://'];
const INTERACTIVE_SOURCE_KINDS = ['cli', 'vscode', 'appServer'];
const SUPPORTED_REASONING_EFFORTS = new Set(['low', 'medium', 'high']);

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sendWriterMessage(writer, payload) {
  try {
    if (!writer) {
      return;
    }

    if (typeof writer.send === 'function') {
      writer.send(payload);
      return;
    }

    if (typeof writer.send === 'undefined' && typeof writer.ws?.send === 'function') {
      writer.ws.send(JSON.stringify(payload));
    }
  } catch (error) {
    console.warn('[CodexAppServer] Failed to send writer payload:', error.message);
  }
}

function sessionSourceKind(source) {
  if (typeof source === 'string') {
    return source;
  }

  if (source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, 'subAgent')) {
    return 'subAgent';
  }

  return 'unknown';
}

function isInteractiveThread(thread) {
  const source = sessionSourceKind(thread?.source);
  return INTERACTIVE_SOURCE_KINDS.includes(source);
}

function mapPermissionModeToCodexOptions(permissionMode = 'plan') {
  switch (permissionMode) {
    case 'acceptEdits':
    case 'bypassPermissions':
      return {
        approvalPolicy: 'never',
        sandbox: 'workspace-write',
      };
    case 'plan':
    case 'default':
    default:
      return {
        approvalPolicy: 'untrusted',
        sandbox: 'workspace-write',
      };
  }
}

function normalizeInputItems(input) {
  if (Array.isArray(input)) {
    return input.map((item) => {
      if (!item || typeof item !== 'object') {
        return { type: 'text', text: String(item ?? ''), text_elements: [] };
      }

      if (item.type === 'local_image') {
        return { type: 'localImage', path: item.path };
      }

      if (item.type === 'localImage') {
        return item;
      }

      if (item.type === 'text') {
        return {
          type: 'text',
          text: item.text || '',
          text_elements: Array.isArray(item.text_elements) ? item.text_elements : [],
        };
      }

      return item;
    });
  }

  return [
    {
      type: 'text',
      text: typeof input === 'string' ? input : String(input ?? ''),
      text_elements: [],
    },
  ];
}

function normalizeReasoningEffort(value) {
  return typeof value === 'string' && SUPPORTED_REASONING_EFFORTS.has(value) ? value : null;
}

function shouldRetryWithoutReasoning(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  return /reasoning|reasoning_effort|unknown field|invalid params?|unsupported|unexpected|unrecognized/i.test(message);
}

function normalizeAppServerError(error, fallbackMessage = 'Codex request failed') {
  if (!error) {
    return new Error(fallbackMessage);
  }

  if (error instanceof Error) {
    return error;
  }

  const message = typeof error.message === 'string' ? error.message : fallbackMessage;
  const normalized = new Error(message);
  if (error.code !== undefined) {
    normalized.code = error.code;
  }
  if (error.data !== undefined) {
    normalized.data = error.data;
  }
  return normalized;
}

function normalizeThreadTokenUsage(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== 'object') {
    return null;
  }

  const total = tokenUsage.total || {};
  return {
    used: total.totalTokens || 0,
    total: tokenUsage.modelContextWindow || 200000,
    breakdown: {
      input: total.inputTokens || 0,
      cacheRead: total.cachedInputTokens || 0,
      output: total.outputTokens || 0,
      reasoning: total.reasoningOutputTokens || 0,
    },
  };
}

function normalizePlanStepStatus(status) {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'inProgress':
    case 'in_progress':
      return 'in_progress';
    case 'pending':
    default:
      return 'pending';
  }
}

function normalizeTurnPlan(plan = []) {
  return plan
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `plan-step-${index}`,
      step: typeof item.step === 'string' && item.step.trim()
        ? item.step
        : `Step ${index + 1}`,
      status: normalizePlanStepStatus(item.status),
    }));
}

function serializeToolOutputContentItems(contentItems) {
  if (!Array.isArray(contentItems) || contentItems.length === 0) {
    return '';
  }

  return contentItems
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      if (typeof item.text === 'string') {
        return item.text;
      }

      if (typeof item.content === 'string') {
        return item.content;
      }

      try {
        return JSON.stringify(item, null, 2);
      } catch {
        return String(item);
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

function buildCodexItemPayload(item, phase = 'completed') {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const basePayload = {
    type: 'item',
    itemId: item.id || null,
    phase,
    isPartial: phase !== 'completed',
  };

  switch (item.type) {
    case 'agentMessage':
      return {
        ...basePayload,
        itemType: 'agent_message',
        message: {
          role: 'assistant',
          content: item.text || '',
        },
      };

    case 'reasoning':
      return {
        ...basePayload,
        itemType: 'reasoning',
        message: {
          role: 'assistant',
          content: [...(item.summary || []), ...(item.content || [])].filter(Boolean).join('\n\n'),
        },
      };

    case 'commandExecution':
      return {
        ...basePayload,
        itemType: 'command_execution',
        command: item.command || '',
        cwd: item.cwd || '',
        commandActions: item.commandActions || [],
        output: item.aggregatedOutput || '',
        exitCode: item.exitCode,
        status: item.status || null,
      };

    case 'fileChange':
      return {
        ...basePayload,
        itemType: 'file_change',
        changes: item.changes || [],
        status: item.status || null,
      };

    case 'mcpToolCall':
      return {
        ...basePayload,
        itemType: 'mcp_tool_call',
        server: item.server || '',
        tool: item.tool || '',
        arguments: item.arguments,
        result: item.result,
        error: item.error,
        status: item.status || null,
      };

    case 'dynamicToolCall':
      return {
        ...basePayload,
        itemType: 'dynamic_tool_call',
        tool: item.tool || '',
        arguments: item.arguments,
        output: serializeToolOutputContentItems(item.contentItems),
        success: item.success,
        status: item.status || null,
      };

    case 'collabAgentToolCall':
      return {
        ...basePayload,
        itemType: 'collab_agent_tool_call',
        tool: item.tool || '',
        prompt: item.prompt || '',
        model: item.model || null,
        reasoningEffort: item.reasoningEffort || null,
        receiverThreadIds: item.receiverThreadIds || [],
        agentsStates: item.agentsStates || {},
        status: item.status || null,
      };

    case 'webSearch':
      return {
        ...basePayload,
        itemType: 'web_search',
        query: item.query || '',
        action: item.action || null,
      };

    case 'plan':
      return {
        ...basePayload,
        itemType: 'plan_text',
        text: item.text || '',
      };

    default:
      return {
        ...basePayload,
        itemType: item.type || 'unknown',
        item,
      };
  }
}

function transformCodexNotification(method, params = {}) {
  switch (method) {
    case 'turn/started':
      return {
        type: 'turn_started',
        turnId: params.turn?.id || null,
        turn: params.turn || null,
      };

    case 'turn/completed':
      return {
        type: 'turn_complete',
        turn: params.turn || null,
      };

    case 'turn/plan/updated':
      return {
        type: 'item',
        itemType: 'todo_list',
        itemId: `plan:${params.turnId || params.threadId || 'unknown'}`,
        explanation: params.explanation || null,
        items: normalizeTurnPlan(params.plan),
      };

    case 'error':
      return {
        type: 'turn_failed',
        turnId: params.turnId || null,
        error: params.error || { message: 'Turn failed' },
        willRetry: Boolean(params.willRetry),
      };

    case 'item/started':
      return buildCodexItemPayload(params.item, 'started');

    case 'item/completed':
      return buildCodexItemPayload(params.item, 'completed');

    case 'item/agentMessage/delta':
      return {
        type: 'item',
        itemType: 'agent_message_delta',
        itemId: params.itemId || null,
        delta: params.delta || '',
      };

    case 'item/reasoning/summaryTextDelta':
      return {
        type: 'item',
        itemType: 'reasoning_delta',
        itemId: params.itemId || null,
        delta: params.delta || '',
        summaryIndex: params.summaryIndex ?? null,
      };

    case 'item/reasoning/summaryPartAdded':
      return {
        type: 'item',
        itemType: 'reasoning_summary_part',
        itemId: params.itemId || null,
        summaryIndex: params.summaryIndex ?? null,
      };

    case 'item/commandExecution/outputDelta':
      return {
        type: 'item',
        itemType: 'command_execution_delta',
        itemId: params.itemId || null,
        delta: params.delta || '',
      };

    default:
      return {
        method,
        params,
      };
  }
}

function buildCodexResponse(method, params) {
  return {
    type: 'codex-response',
    sessionId: params?.threadId || params?.thread?.id || null,
    data: transformCodexNotification(method, params),
  };
}

function buildPendingQuestion(question) {
  return {
    id: question.id,
    header: question.header,
    question: question.question,
    options: Array.isArray(question.options) ? question.options : [],
    multiSelect: false,
    allowOther: Boolean(question.isOther),
    isSecret: Boolean(question.isSecret),
  };
}

function buildPendingApprovalRequest(method, requestId, params) {
  if (method === 'item/commandExecution/requestApproval') {
    return {
      requestId,
      provider: 'codex',
      requestKind: 'approval',
      toolName: 'Bash',
      input: {
        command: params.command || '',
        cwd: params.cwd || '',
        reason: params.reason || null,
        commandActions: params.commandActions || [],
      },
      context: params,
      sessionId: params.threadId,
      receivedAt: new Date(),
    };
  }

  if (method === 'item/fileChange/requestApproval') {
    return {
      requestId,
      provider: 'codex',
      requestKind: 'approval',
      toolName: 'Edit',
      input: {
        reason: params.reason || null,
        grantRoot: params.grantRoot || null,
      },
      context: params,
      sessionId: params.threadId,
      receivedAt: new Date(),
    };
  }

  if (method === 'applyPatchApproval') {
    return {
      requestId,
      provider: 'codex',
      requestKind: 'approval',
      toolName: 'Edit',
      input: {
        reason: params.reason || null,
        fileChanges: params.fileChanges || {},
        grantRoot: params.grantRoot || null,
      },
      context: params,
      sessionId: params.conversationId,
      receivedAt: new Date(),
    };
  }

  return {
    requestId,
    provider: 'codex',
    requestKind: 'approval',
    toolName: 'Bash',
    input: {
      command: Array.isArray(params.command) ? params.command.join(' ') : params.command || '',
      cwd: params.cwd || '',
      reason: params.reason || null,
      parsedCmd: params.parsedCmd || [],
    },
    context: params,
    sessionId: params.conversationId,
    receivedAt: new Date(),
  };
}

function buildUnsupportedError(message = 'Legacy Codex exec sessions are unsupported') {
  const error = new Error(message);
  error.code = 'CODEX_THREAD_UNSUPPORTED';
  error.statusCode = 404;
  error.unsupported = true;
  return error;
}

function buildNotFoundError(message = 'Codex thread not found') {
  const error = new Error(message);
  error.code = 'CODEX_THREAD_NOT_FOUND';
  error.statusCode = 404;
  return error;
}

function createSqliteConnection(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(db);
    });
  });
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function cleanupSqliteThreadReferences(filePath, statements, threadId) {
  try {
    await fs.access(filePath);
  } catch {
    return;
  }

  const db = await createSqliteConnection(filePath);
  try {
    for (const statement of statements) {
      try {
        await runSql(db, statement, [threadId]);
      } catch (error) {
        console.warn('[CodexAppServer] Failed SQLite cleanup statement:', statement, error.message);
      }
    }
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
}

class CodexAppServer {
  constructor() {
    this.child = null;
    this.startPromise = null;
    this.pendingRequests = new Map();
    this.stdoutBuffer = '';
    this.nextRequestId = 1;
    this.threadWriters = new Map();
    this.activeTurns = new Map();
    this.turnWaiters = new Map();
    this.loadedThreads = new Set();
    this.pendingUiRequests = new Map();
    this.pendingUiRequestsByThread = new Map();
    this.threadTokenUsage = new Map();
  }

  async ensureStarted() {
    if (this.child && !this.child.killed) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.start();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async start() {
    this.child = spawn('codex', CODEX_APP_SERVER_ARGS, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk) => this.handleStdout(chunk));
    this.child.stderr?.setEncoding('utf8');
    this.child.stderr?.on('data', (chunk) => {
      const output = String(chunk || '').trim();
      if (output) {
        console.warn('[CodexAppServer][stderr]', output);
      }
    });

    this.child.on('exit', (code, signal) => this.handleExit(code, signal));
    this.child.on('error', (error) => this.handleFatalError(error));

    await this.sendRequest('initialize', {
      clientInfo: {
        name: 'claudecodeui',
        version: process.env.npm_package_version || '0.0.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    this.sendNotification('initialized');
  }

  handleFatalError(error) {
    this.handleExit(null, null, normalizeAppServerError(error, 'Codex app-server crashed'));
  }

  handleExit(code, signal, cause = null) {
    const error = cause || new Error(`Codex app-server exited${code !== null && code !== undefined ? ` with code ${code}` : ''}${signal ? ` (signal ${signal})` : ''}`);

    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }

    for (const [turnId, waiter] of this.turnWaiters.entries()) {
      waiter.reject(error);
      this.turnWaiters.delete(turnId);
    }

    for (const [threadId, activeTurn] of this.activeTurns.entries()) {
      this.broadcastToThread(threadId, {
        type: 'codex-error',
        sessionId: threadId,
        provider: 'codex',
        error: error.message,
      });
      activeTurn.status = 'failed';
    }

    this.activeTurns.clear();
    this.loadedThreads.clear();
    this.pendingUiRequests.clear();
    this.pendingUiRequestsByThread.clear();
    this.threadWriters.clear();
    this.child = null;
    this.stdoutBuffer = '';
  }

  handleStdout(chunk) {
    this.stdoutBuffer += String(chunk || '');

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      this.handleLine(line).catch((error) => {
        console.warn('[CodexAppServer] Failed to handle stdout line:', error.message);
      });
    }
  }

  async handleLine(line) {
    let message;

    try {
      message = JSON.parse(line);
    } catch (error) {
      console.warn('[CodexAppServer] Non-JSON stdout:', line);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
      await this.handleServerRequest(message);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      this.handleResponse(message);
      return;
    }

    if (message.method) {
      this.handleNotification(message);
    }
  }

  handleResponse(message) {
    const requestId = String(message.id);
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(requestId);

    if (message.error) {
      pending.reject(normalizeAppServerError(message.error));
      return;
    }

    pending.resolve(message.result);
  }

  async handleServerRequest(message) {
    const requestId = String(message.id);
    const { method, params = {} } = message;

    if (method === 'item/tool/call') {
      this.sendResponse(requestId, {
        success: false,
        contentItems: [{ type: 'inputText', text: 'Dynamic tool calls are not supported in CloudCLI UI.' }],
      });
      return;
    }

    if (method === 'account/chatgptAuthTokens/refresh') {
      this.sendJsonRpcError(requestId, 'ChatGPT auth token refresh is not supported in CloudCLI UI.');
      return;
    }

    if (method === 'item/tool/requestUserInput') {
      const pendingRequest = {
        requestId,
        provider: 'codex',
        requestKind: 'user-input',
        toolName: 'AskUserQuestion',
        input: {
          questions: Array.isArray(params.questions) ? params.questions.map(buildPendingQuestion) : [],
        },
        context: params,
        sessionId: params.threadId,
        receivedAt: new Date(),
      };

      this.storePendingUiRequest(pendingRequest, {
        method,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
      });

      this.broadcastToThread(params.threadId, {
        type: 'codex-user-input-request',
        sessionId: params.threadId,
        ...pendingRequest,
      });
      return;
    }

    if (
      method === 'item/commandExecution/requestApproval'
      || method === 'item/fileChange/requestApproval'
      || method === 'applyPatchApproval'
      || method === 'execCommandApproval'
    ) {
      const pendingRequest = buildPendingApprovalRequest(method, requestId, params);

      this.storePendingUiRequest(pendingRequest, {
        method,
        threadId: params.threadId || params.conversationId,
        turnId: params.turnId || null,
        itemId: params.itemId || params.callId || null,
      });

      this.broadcastToThread(pendingRequest.sessionId, {
        type: 'codex-approval-request',
        sessionId: pendingRequest.sessionId,
        ...pendingRequest,
      });
      return;
    }

    this.sendJsonRpcError(requestId, `Unsupported server request: ${method}`);
  }

  handleNotification(message) {
    const { method, params = {} } = message;

    if (method.startsWith('codex/event/')) {
      return;
    }

    if (method === 'thread/started') {
      if (params.thread?.id) {
        this.loadedThreads.add(params.thread.id);
      }
      return;
    }

    if (method === 'thread/tokenUsage/updated') {
      const normalized = normalizeThreadTokenUsage(params.tokenUsage);
      if (normalized) {
        this.threadTokenUsage.set(params.threadId, normalized);
        this.broadcastToThread(params.threadId, {
          type: 'token-budget',
          sessionId: params.threadId,
          data: normalized,
        });
      }
      return;
    }

    if (method === 'turn/started') {
      const activeTurn = this.activeTurns.get(params.threadId);
      if (activeTurn) {
        activeTurn.turnId = params.turn?.id || activeTurn.turnId;
      }

      this.broadcastToThread(params.threadId, buildCodexResponse(method, params));
      return;
    }

    if (method === 'turn/completed') {
      this.broadcastToThread(params.threadId, buildCodexResponse(method, params));
      this.finishTurn(params.threadId, params.turn);
      return;
    }

    if (method === 'error') {
      this.broadcastToThread(params.threadId, buildCodexResponse(method, params));
      if (!params.willRetry) {
        this.finishTurn(params.threadId, {
          id: params.turnId,
          status: 'failed',
          error: params.error,
        });
      }
      return;
    }

    if (method === 'item/commandExecution/terminalInteraction') {
      const requestId = `stdin:${params.threadId}:${params.turnId}:${params.itemId}:${Date.now()}`;
      const pendingRequest = {
        requestId,
        provider: 'codex',
        requestKind: 'terminal-stdin',
        toolName: 'CodexTerminalInput',
        input: {
          prompt: 'Provide terminal input',
          processId: params.processId,
          initialValue: '',
          observedStdin: params.stdin || '',
        },
        context: params,
        sessionId: params.threadId,
        receivedAt: new Date(),
      };

      this.storePendingUiRequest(pendingRequest, {
        method,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        processId: params.processId,
      });

      this.broadcastToThread(params.threadId, buildCodexResponse(method, params));
      this.broadcastToThread(params.threadId, {
        type: 'codex-command-stdin-request',
        sessionId: params.threadId,
        ...pendingRequest,
      });
      return;
    }

    this.broadcastToThread(params.threadId || params.thread?.id || null, buildCodexResponse(method, params));
  }

  finishTurn(threadId, turn) {
    if (!threadId) {
      return;
    }

    const activeTurn = this.activeTurns.get(threadId);
    if (activeTurn) {
      this.activeTurns.delete(threadId);
      if (activeTurn.turnId && this.turnWaiters.has(activeTurn.turnId)) {
        const waiter = this.turnWaiters.get(activeTurn.turnId);
        this.turnWaiters.delete(activeTurn.turnId);
        waiter.resolve(turn);
      }
    }

    this.clearPendingUiRequests(threadId);
  }

  storePendingUiRequest(request, metadata) {
    this.pendingUiRequests.set(request.requestId, {
      ...request,
      metadata,
    });

    if (!this.pendingUiRequestsByThread.has(request.sessionId)) {
      this.pendingUiRequestsByThread.set(request.sessionId, new Map());
    }

    this.pendingUiRequestsByThread.get(request.sessionId).set(request.requestId, {
      ...request,
      metadata,
    });
  }

  clearPendingUiRequests(threadId) {
    const pendingByThread = this.pendingUiRequestsByThread.get(threadId);
    if (!pendingByThread) {
      return;
    }

    for (const requestId of pendingByThread.keys()) {
      this.pendingUiRequests.delete(requestId);
      this.broadcastToThread(threadId, {
        type: 'codex-request-cancelled',
        sessionId: threadId,
        requestId,
      });
    }

    this.pendingUiRequestsByThread.delete(threadId);
  }

  sendRaw(message) {
    if (!this.child?.stdin || this.child.killed) {
      throw new Error('Codex app-server is not running');
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  sendNotification(method, params) {
    const payload = { method };
    if (params !== undefined) {
      payload.params = params;
    }
    this.sendRaw(payload);
  }

  sendResponse(id, result) {
    this.sendRaw({ id, result });
  }

  sendJsonRpcError(id, message, code = -32603, data = undefined) {
    this.sendRaw({
      id,
      error: {
        code,
        message,
        data,
      },
    });
  }

  async sendRequest(method, params) {
    await this.ensureStarted();

    const requestId = String(this.nextRequestId++);
    const deferred = createDeferred();
    const timeoutId = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      deferred.reject(new Error(`Codex app-server request timed out: ${method}`));
    }, REQUEST_TIMEOUT_MS);

    this.pendingRequests.set(requestId, {
      resolve: deferred.resolve,
      reject: deferred.reject,
      timeoutId,
    });

    this.sendRaw({ id: requestId, method, params });

    return deferred.promise;
  }

  registerWriter(threadId, writer) {
    if (!threadId || !writer) {
      return;
    }

    if (typeof writer.setSessionId === 'function') {
      writer.setSessionId(threadId);
    }

    if (!this.threadWriters.has(threadId)) {
      this.threadWriters.set(threadId, new Set());
    }

    this.threadWriters.get(threadId).add(writer);
  }

  unregisterWriter(threadId, writer) {
    if (!threadId || !writer) {
      return;
    }
    const writers = this.threadWriters.get(threadId);
    if (writers) {
      writers.delete(writer);
      if (writers.size === 0) {
        this.threadWriters.delete(threadId);
      }
    }
  }

  broadcastToThread(threadId, payload) {
    if (!threadId) {
      return;
    }

    const writers = this.threadWriters.get(threadId);
    if (!writers) {
      return;
    }

    for (const writer of writers) {
      sendWriterMessage(writer, payload);
    }

    for (const writer of writers) {
      if (writer.isDead) {
        writers.delete(writer);
      }
    }

    if (writers.size === 0) {
      this.threadWriters.delete(threadId);
    }
  }

  async startThread(options = {}) {
    const response = await this.sendRequest('thread/start', {
      cwd: options.cwd || process.cwd(),
      approvalPolicy: options.approvalPolicy || null,
      sandbox: options.sandbox || null,
      model: options.model || null,
      modelProvider: options.modelProvider || null,
      experimentalRawEvents: false,
    });

    if (response?.thread?.id) {
      this.loadedThreads.add(response.thread.id);
    }

    return response;
  }

  async resumeThread(threadId, options = {}) {
    const response = await this.sendRequest('thread/resume', {
      threadId,
      cwd: options.cwd || null,
      approvalPolicy: options.approvalPolicy || null,
      sandbox: options.sandbox || null,
      model: options.model || null,
      modelProvider: options.modelProvider || null,
    });

    if (response?.thread?.id) {
      this.loadedThreads.add(response.thread.id);
    }

    return response;
  }

  async ensureThreadLoaded(threadId, options = {}) {
    if (this.loadedThreads.has(threadId)) {
      return;
    }

    await this.resumeThread(threadId, options);
  }

  async startTurn(threadId, input, options = {}, writer = null) {
    await this.ensureThreadLoaded(threadId, options);

    if (writer) {
      this.registerWriter(threadId, writer);
    }

    const requestParams = {
      threadId,
      input: normalizeInputItems(input),
      cwd: options.cwd || null,
      approvalPolicy: options.approvalPolicy || null,
      model: options.model || null,
    };
    const normalizedReasoningEffort = normalizeReasoningEffort(options.reasoningEffort);

    if (normalizedReasoningEffort) {
      requestParams.reasoningEffort = normalizedReasoningEffort;
    }

    let result;
    try {
      result = await this.sendRequest('turn/start', requestParams);
    } catch (error) {
      if (!normalizedReasoningEffort || !shouldRetryWithoutReasoning(error)) {
        throw error;
      }

      console.warn('[CodexAppServer] Retrying turn without reasoning effort:', error.message);
      delete requestParams.reasoningEffort;
      result = await this.sendRequest('turn/start', requestParams);
    }

    const turn = result?.turn || null;
    const deferred = createDeferred();

    if (turn?.id) {
      this.activeTurns.set(threadId, {
        threadId,
        turnId: turn.id,
        startedAt: Date.now(),
        status: 'running',
      });
      this.turnWaiters.set(turn.id, deferred);
    } else {
      deferred.resolve(turn);
    }

    return {
      turn,
      completion: deferred.promise,
    };
  }

  async interruptTurn(threadId) {
    const activeTurn = this.activeTurns.get(threadId);
    if (!activeTurn?.turnId) {
      return false;
    }

    await this.sendRequest('turn/interrupt', {
      threadId,
      turnId: activeTurn.turnId,
    });

    return true;
  }

  async listThreads(options = {}) {
    const results = [];
    let cursor = options.cursor || null;

    while (true) {
      const page = await this.sendRequest('thread/list', {
        cursor,
        limit: options.pageSize || 100,
        sourceKinds: Array.isArray(options.sourceKinds) ? options.sourceKinds : INTERACTIVE_SOURCE_KINDS,
        archived: options.archived ?? false,
      });

      const threads = Array.isArray(page?.data) ? page.data : [];
      results.push(...threads);

      if (!page?.nextCursor || options.singlePage) {
        return {
          data: results,
          nextCursor: page?.nextCursor || null,
        };
      }

      cursor = page.nextCursor;
    }
  }

  async readThread(threadId, includeTurns = true) {
    const result = await this.sendRequest('thread/read', {
      threadId,
      includeTurns,
    });

    const thread = result?.thread;
    if (!thread) {
      throw buildNotFoundError();
    }

    return thread;
  }

  reconnectWriter(threadId, writer) {
    this.registerWriter(threadId, writer);
  }

  isThreadActive(threadId) {
    return this.activeTurns.has(threadId);
  }

  getActiveThreads() {
    return Array.from(this.activeTurns.entries()).map(([id, turn]) => ({
      id,
      status: turn.status,
      startedAt: new Date(turn.startedAt).toISOString(),
    }));
  }

  getPendingRequests(threadId) {
    const pendingByThread = this.pendingUiRequestsByThread.get(threadId);
    if (!pendingByThread) {
      return [];
    }

    return Array.from(pendingByThread.values()).map(({ metadata, ...request }) => request);
  }

  async respondToApproval(requestId, decision = {}) {
    const pending = this.pendingUiRequests.get(requestId);
    if (!pending) {
      return false;
    }

    const { metadata } = pending;
    const allow = Boolean(decision.allow);
    const allowForSession = Boolean(decision.allowForSession || decision.rememberEntry);
    let result;

    if (metadata.method === 'item/commandExecution/requestApproval') {
      result = {
        decision: allow
          ? (allowForSession ? 'acceptForSession' : 'accept')
          : 'decline',
      };
      this.sendResponse(requestId, result);
    } else if (metadata.method === 'item/fileChange/requestApproval') {
      result = {
        decision: allow
          ? (allowForSession ? 'acceptForSession' : 'accept')
          : 'decline',
      };
      this.sendResponse(requestId, result);
    } else if (metadata.method === 'applyPatchApproval' || metadata.method === 'execCommandApproval') {
      result = {
        decision: allow
          ? (allowForSession ? 'approved_for_session' : 'approved')
          : 'denied',
      };
      this.sendResponse(requestId, result);
    } else {
      return false;
    }

    this.deletePendingRequest(requestId, pending.sessionId);
    return true;
  }

  async respondToUserInput(requestId, answers = {}) {
    const pending = this.pendingUiRequests.get(requestId);
    if (!pending || pending.requestKind !== 'user-input') {
      return false;
    }

    const normalizedAnswers = {};
    for (const [key, value] of Object.entries(answers || {})) {
      if (Array.isArray(value)) {
        normalizedAnswers[key] = { answers: value.map((item) => String(item)) };
      } else if (value && typeof value === 'object' && Array.isArray(value.answers)) {
        normalizedAnswers[key] = { answers: value.answers.map((item) => String(item)) };
      } else if (value !== undefined && value !== null && String(value).trim()) {
        normalizedAnswers[key] = { answers: [String(value)] };
      }
    }

    this.sendResponse(requestId, {
      answers: normalizedAnswers,
    });

    this.deletePendingRequest(requestId, pending.sessionId);
    return true;
  }

  async respondToTerminalInput(requestId, text = '') {
    const pending = this.pendingUiRequests.get(requestId);
    if (!pending || pending.requestKind !== 'terminal-stdin') {
      return false;
    }

    await this.sendRequest('turn/steer', {
      threadId: pending.metadata.threadId,
      expectedTurnId: pending.metadata.turnId,
      input: normalizeInputItems(text),
    });

    this.deletePendingRequest(requestId, pending.sessionId);
    return true;
  }

  deletePendingRequest(requestId, threadId) {
    const pending = this.pendingUiRequests.get(requestId);
    this.pendingUiRequests.delete(requestId);

    const pendingByThread = this.pendingUiRequestsByThread.get(threadId);
    if (pendingByThread) {
      pendingByThread.delete(requestId);
      if (pendingByThread.size === 0) {
        this.pendingUiRequestsByThread.delete(threadId);
      }
    }

    if (pending) {
      this.broadcastToThread(threadId, {
        type: 'codex-request-cancelled',
        sessionId: threadId,
        requestId,
      });
    }
  }

  async resolveInteractiveThread(threadId, includeTurns = false) {
    let thread;

    try {
      thread = await this.readThread(threadId, includeTurns);
    } catch (error) {
      const normalizedError = normalizeAppServerError(error, 'Failed to read Codex thread');
      if (normalizedError.code === -32004 || /not found/i.test(normalizedError.message || '')) {
        throw buildNotFoundError();
      }
      throw normalizedError;
    }

    if (!isInteractiveThread(thread)) {
      throw buildUnsupportedError();
    }

    return thread;
  }

  async deleteThreadHard(threadId) {
    const thread = await this.resolveInteractiveThread(threadId, false);

    if (this.isThreadActive(threadId)) {
      try {
        await this.interruptTurn(threadId);
      } catch (error) {
        console.warn('[CodexAppServer] Failed to interrupt active turn before delete:', error.message);
      }
    }

    this.activeTurns.delete(threadId);
    this.clearPendingUiRequests(threadId);
    this.threadWriters.delete(threadId);
    this.loadedThreads.delete(threadId);
    this.threadTokenUsage.delete(threadId);

    if (thread.path) {
      try {
        await fs.rm(thread.path, { force: true });
      } catch (error) {
        console.warn('[CodexAppServer] Failed to delete rollout file:', error.message);
      }
    }

    const codexRoot = path.join(os.homedir(), '.codex');
    const sessionIndexPath = path.join(codexRoot, 'session_index.jsonl');
    try {
      const content = await fs.readFile(sessionIndexPath, 'utf8');
      const nextLines = content
        .split('\n')
        .filter((line) => line.trim())
        .filter((line) => {
          try {
            const parsed = JSON.parse(line);
            const id = parsed.id || parsed.thread_id || parsed.threadId || parsed.session_id || parsed.conversationId;
            const rolloutPath = parsed.path || parsed.rolloutPath || parsed.rollout_path;
            return id !== threadId && rolloutPath !== thread.path;
          } catch {
            return !line.includes(threadId);
          }
        });
      const nextContent = nextLines.length > 0 ? `${nextLines.join('\n')}\n` : '';
      await fs.writeFile(sessionIndexPath, nextContent, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[CodexAppServer] Failed to rewrite session index:', error.message);
      }
    }

    try {
      await fs.rm(path.join(codexRoot, 'shell_snapshots', `${threadId}.sh`), { force: true });
    } catch (error) {
      console.warn('[CodexAppServer] Failed to remove shell snapshot:', error.message);
    }

    await cleanupSqliteThreadReferences(
      path.join(codexRoot, 'state_5.sqlite'),
      [
        'DELETE FROM threads WHERE id = ?',
        'DELETE FROM stage1_outputs WHERE thread_id = ?',
        'DELETE FROM thread_dynamic_tools WHERE thread_id = ?',
        'DELETE FROM agent_job_items WHERE assigned_thread_id = ?',
      ],
      threadId,
    );

    await cleanupSqliteThreadReferences(
      path.join(codexRoot, 'logs_1.sqlite'),
      ['DELETE FROM logs WHERE thread_id = ?'],
      threadId,
    );

    return true;
  }

  getThreadTokenUsage(threadId) {
    return this.threadTokenUsage.get(threadId) || null;
  }
}

export const codexAppServer = new CodexAppServer();
export {
  buildNotFoundError,
  buildUnsupportedError,
  INTERACTIVE_SOURCE_KINDS,
  isInteractiveThread,
  mapPermissionModeToCodexOptions,
  normalizeInputItems,
  normalizeThreadTokenUsage,
  sendWriterMessage,
  sessionSourceKind,
};
