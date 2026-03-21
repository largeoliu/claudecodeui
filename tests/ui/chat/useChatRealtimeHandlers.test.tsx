// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import { useChatRealtimeHandlers } from '../../../src/components/chat/hooks/useChatRealtimeHandlers';
import type { ChatMessage, PendingPermissionRequest } from '../../../src/components/chat/types/types';
import { getChatMessagesStorageKey } from '../../../src/components/chat/utils/chatStorage';
import type { Project, ProjectSession, SessionProvider } from '../../../src/types/app';
import { CODEX_MISSING_FINAL_SUMMARY_MESSAGE } from '../../../shared/codexCompletion';

type HarnessOptions = {
  provider?: SessionProvider;
  selectedProject?: Project | null;
  selectedSession?: ProjectSession | null;
  initialCurrentSessionId?: string | null;
  initialChatMessages?: ChatMessage[];
  initialIsLoading?: boolean;
  initialCanAbortSession?: boolean;
  initialClaudeStatus?: { text: string; tokens: number; can_interrupt: boolean } | null;
  initialTokenBudget?: Record<string, unknown> | null;
  initialPendingPermissionRequests?: PendingPermissionRequest[];
  pendingViewSession?: { sessionId: string | null; startedAt: number } | null;
  streamBuffer?: string;
  streamTimer?: number | null;
};

function renderRealtimeHarness(options: HarnessOptions = {}) {
  const callbacks = {
    onSessionInactive: vi.fn(),
    onSessionProcessing: vi.fn(),
    onSessionNotProcessing: vi.fn(),
    onReplaceTemporarySession: vi.fn(),
    onCodexSessionCreated: vi.fn(),
    onNavigateToSession: vi.fn(),
    onWebSocketReconnect: vi.fn(),
    onCodexInteractiveRequestSettled: vi.fn(),
  };

  const pendingViewSessionRef = { current: options.pendingViewSession ?? null };
  const streamBufferRef = { current: options.streamBuffer ?? '' };
  const streamTimerRef = { current: options.streamTimer ?? null };

  const hasSelectedProject = Object.prototype.hasOwnProperty.call(options, 'selectedProject');
  const hasSelectedSession = Object.prototype.hasOwnProperty.call(options, 'selectedSession');

  const selectedProject = hasSelectedProject ? options.selectedProject! : {
    name: 'demo-project',
    displayName: 'Demo Project',
    fullPath: '/work/demo-project',
  };

  const selectedSession = hasSelectedSession ? options.selectedSession! : {
    id: options.initialCurrentSessionId ?? 'session-1',
    __provider: options.provider ?? 'claude',
  };

  const { result, rerender } = renderHook(
    ({ latestMessage }: { latestMessage: any }) => {
      const [currentSessionId, setCurrentSessionId] = useState<string | null>(options.initialCurrentSessionId ?? selectedSession?.id ?? null);
      const [chatMessages, setChatMessages] = useState<ChatMessage[]>(options.initialChatMessages ?? []);
      const [isLoading, setIsLoading] = useState(options.initialIsLoading ?? false);
      const [canAbortSession, setCanAbortSession] = useState(options.initialCanAbortSession ?? false);
      const [claudeStatus, setClaudeStatus] = useState(options.initialClaudeStatus ?? null);
      const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(options.initialTokenBudget ?? null);
      const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
      const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>(
        options.initialPendingPermissionRequests ?? [],
      );

      useChatRealtimeHandlers({
        latestMessage,
        provider: options.provider ?? 'claude',
        selectedProject,
        selectedSession,
        currentSessionId,
        setCurrentSessionId,
        setChatMessages,
        setIsLoading,
        setCanAbortSession,
        setClaudeStatus,
        setTokenBudget,
        setIsSystemSessionChange,
        pendingPermissionRequests,
        setPendingPermissionRequests,
        pendingViewSessionRef,
        streamBufferRef,
        streamTimerRef,
        ...callbacks,
      });

      return {
        currentSessionId,
        chatMessages,
        isLoading,
        canAbortSession,
        claudeStatus,
        tokenBudget,
        isSystemSessionChange,
        pendingPermissionRequests,
      };
    },
    {
      initialProps: {
        latestMessage: null,
      },
    },
  );

  const emitMessage = async (latestMessage: any) => {
    await act(async () => {
      rerender({ latestMessage });
    });
  };

  return {
    result,
    emitMessage,
    callbacks,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
  };
}

describe('useChatRealtimeHandlers', () => {
  beforeEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
    delete (window as any).refreshProjects;
  });

  it('binds a newly created session to the pending view and pending permissions', async () => {
    const harness = renderRealtimeHarness({
      provider: 'codex',
      selectedSession: null,
      initialCurrentSessionId: null,
      initialPendingPermissionRequests: [
        { requestId: 'req-1', toolName: 'Bash' },
      ],
      pendingViewSession: { sessionId: null, startedAt: Date.now() },
    });

    await harness.emitMessage({ type: 'session-created', sessionId: 'session-123' });

    expect(sessionStorage.getItem('pendingSessionId')).toBe('session-123');
    expect(harness.pendingViewSessionRef.current?.sessionId).toBe('session-123');
    expect(harness.result.current.isSystemSessionChange).toBe(true);
    expect(harness.result.current.pendingPermissionRequests).toEqual([
      expect.objectContaining({ requestId: 'req-1', sessionId: 'session-123' }),
    ]);
    expect(harness.callbacks.onReplaceTemporarySession).toHaveBeenCalledWith('session-123');
    expect(harness.callbacks.onCodexSessionCreated).toHaveBeenCalledWith('session-123');
  });

  it('handles reconnect events only once per message object', async () => {
    const harness = renderRealtimeHarness();
    const reconnectMessage = { type: 'websocket-reconnected' };

    await harness.emitMessage(reconnectMessage);
    await harness.emitMessage(reconnectMessage);

    expect(harness.callbacks.onWebSocketReconnect).toHaveBeenCalledTimes(1);
  });

  it('streams Claude deltas into a single assistant message and finalizes on stop', async () => {
    vi.useFakeTimers();
    const harness = renderRealtimeHarness();

    await harness.emitMessage({
      type: 'claude-response',
      sessionId: 'session-1',
      data: {
        message: {
          type: 'content_block_delta',
          delta: { text: 'Hello &amp; world' },
        },
      },
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(harness.result.current.chatMessages).toEqual([
      expect.objectContaining({
        type: 'assistant',
        content: 'Hello & world',
        isStreaming: true,
      }),
    ]);

    await harness.emitMessage({
      type: 'claude-response',
      sessionId: 'session-1',
      data: {
        message: {
          type: 'content_block_stop',
        },
      },
    });

    expect(harness.result.current.chatMessages[0]).toMatchObject({
      type: 'assistant',
      content: 'Hello & world',
      isStreaming: false,
    });
  });

  it('finalizes lifecycle state on Claude errors and flushes buffered content', async () => {
    vi.useFakeTimers();
    const timerId = window.setTimeout(() => undefined, 5_000);
    const harness = renderRealtimeHarness({
      initialIsLoading: true,
      initialCanAbortSession: true,
      initialClaudeStatus: { text: 'Processing', tokens: 10, can_interrupt: true },
      initialPendingPermissionRequests: [
        { requestId: 'req-1', toolName: 'Bash', sessionId: 'session-1' },
      ],
      pendingViewSession: { sessionId: 'session-1', startedAt: Date.now() },
      streamBuffer: 'partial output',
      streamTimer: timerId,
    });

    await harness.emitMessage({ type: 'claude-error', sessionId: 'session-1', error: 'boom' });

    expect(harness.streamTimerRef.current).toBeNull();
    expect(harness.streamBufferRef.current).toBe('');
    expect(harness.pendingViewSessionRef.current).toBeNull();
    expect(harness.result.current.isLoading).toBe(false);
    expect(harness.result.current.canAbortSession).toBe(false);
    expect(harness.result.current.claudeStatus).toBeNull();
    expect(harness.result.current.pendingPermissionRequests).toEqual([]);
    expect(harness.result.current.chatMessages).toEqual([
      expect.objectContaining({ type: 'assistant', content: 'partial output', isStreaming: false }),
      expect.objectContaining({ type: 'error', content: 'Error: boom' }),
    ]);
    expect(harness.callbacks.onSessionInactive).toHaveBeenCalledWith('session-1');
    expect(harness.callbacks.onSessionNotProcessing).toHaveBeenCalledWith('session-1');
  });

  it('updates loading indicators from codex session status and clears them when processing stops', async () => {
    const harness = renderRealtimeHarness({
      provider: 'codex',
      initialPendingPermissionRequests: [
        {
          requestId: 'req-1',
          provider: 'codex',
          requestKind: 'user-input',
          toolName: 'Bash',
          sessionId: 'session-1',
        },
      ],
    });

    await harness.emitMessage({ type: 'session-status', sessionId: 'session-1', isProcessing: true });

    expect(harness.result.current.isLoading).toBe(true);
    expect(harness.result.current.canAbortSession).toBe(true);
    expect(harness.result.current.claudeStatus).toEqual({
      text: 'Waiting for input',
      tokens: 0,
      can_interrupt: true,
    });
    expect(harness.callbacks.onSessionProcessing).toHaveBeenCalledWith('session-1');

    await harness.emitMessage({ type: 'session-status', sessionId: 'session-1', isProcessing: false });

    expect(harness.result.current.isLoading).toBe(false);
    expect(harness.result.current.canAbortSession).toBe(false);
    expect(harness.result.current.claudeStatus).toBeNull();
    expect(harness.callbacks.onSessionInactive).toHaveBeenCalledWith('session-1');
    expect(harness.callbacks.onSessionNotProcessing).toHaveBeenCalledWith('session-1');
  });

  it('removes acknowledged Codex requests and re-syncs session state', async () => {
    const harness = renderRealtimeHarness({
      provider: 'codex',
      initialPendingPermissionRequests: [
        {
          requestId: 'req-1',
          provider: 'codex',
          requestKind: 'approval',
          toolName: 'Bash',
          sessionId: 'session-1',
        },
      ],
    });

    await harness.emitMessage({
      type: 'codex-interactive-response-ack',
      requestId: 'req-1',
      requestKind: 'approval',
    });

    expect(harness.result.current.pendingPermissionRequests).toEqual([]);
    expect(harness.callbacks.onCodexInteractiveRequestSettled).toHaveBeenCalledTimes(1);
  });

  it('shows an error when a Codex request expires before apply', async () => {
    const harness = renderRealtimeHarness({
      provider: 'codex',
      initialPendingPermissionRequests: [
        {
          requestId: 'req-1',
          provider: 'codex',
          requestKind: 'approval',
          toolName: 'Bash',
          sessionId: 'session-1',
        },
      ],
    });

    await harness.emitMessage({
      type: 'codex-interactive-response-error',
      requestId: 'req-1',
      requestKind: 'approval',
      code: 'not_found',
      error: 'Request is no longer pending.',
    });

    expect(harness.result.current.pendingPermissionRequests).toEqual([]);
    expect(harness.result.current.chatMessages).toEqual([
      expect.objectContaining({
        type: 'error',
        content: 'This Codex request expired before it could be applied. The session has been refreshed.',
      }),
    ]);
    expect(harness.callbacks.onCodexInteractiveRequestSettled).toHaveBeenCalledTimes(1);
  });

  it('streams Codex assistant and reasoning items into separate messages', async () => {
    const harness = renderRealtimeHarness({ provider: 'codex' });

    await harness.emitMessage({
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'agent_message_delta',
        itemId: 'assistant-1',
        delta: 'Hello &amp; ',
      },
    });
    await harness.emitMessage({
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: 'assistant-1',
        message: { content: 'Hello &amp; world' },
      },
    });
    await harness.emitMessage({
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'reasoning_delta',
        itemId: 'thinking-1',
        delta: 'Step 1',
      },
    });
    await harness.emitMessage({
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'reasoning',
        itemId: 'thinking-1',
        message: { content: 'Step 1 -> done' },
      },
    });

    expect(harness.result.current.chatMessages).toEqual([
      expect.objectContaining({
        type: 'assistant',
        content: 'Hello & world',
        toolId: 'assistant-1',
        isThinking: false,
        isStreaming: false,
      }),
      expect.objectContaining({
        type: 'assistant',
        content: 'Step 1 -> done',
        toolId: 'thinking-1',
        isThinking: true,
        isStreaming: false,
      }),
    ]);
  });

  it('maps Codex command, file, and custom tool items into tool-use messages', async () => {
    const harness = renderRealtimeHarness({ provider: 'codex' });

    await harness.emitMessage({
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'command_execution',
        itemId: 'command-1',
        command: 'npm test',
        cwd: '/work/demo-project',
        exitCode: null,
      },
    });
    await harness.emitMessage({
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'command_execution_delta',
        itemId: 'command-1',
        delta: 'line 1\n',
      },
    });
    await harness.emitMessage({
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'file_change',
        itemId: 'edit-1',
        changes: [{ kind: 'update', path: 'src/App.tsx' }],
        phase: 'completed',
        status: 'failed',
      },
    });
    await harness.emitMessage({
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'function_call',
        item: {
          call_id: 'tool-1',
          name: 'shell_command',
          arguments: '{"command":"ls -la"}',
        },
      },
    });
    await harness.emitMessage({
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'function_call_output',
        item: {
          call_id: 'tool-1',
          output: { ok: true },
        },
      },
    });

    expect(harness.result.current.chatMessages).toEqual([
      expect.objectContaining({
        isToolUse: true,
        toolId: 'command-1',
        toolName: 'Bash',
        toolInput: { command: 'npm test', cwd: '/work/demo-project' },
        toolResult: expect.objectContaining({ content: 'line 1\n', isError: false }),
      }),
      expect.objectContaining({
        isToolUse: true,
        toolId: 'edit-1',
        toolName: 'Edit',
        toolInput: 'update: src/App.tsx',
        toolResult: expect.objectContaining({ content: 'Status: failed', isError: true }),
      }),
      expect.objectContaining({
        isToolUse: true,
        toolId: 'tool-1',
        toolName: 'Bash',
        toolInput: { command: 'ls -la' },
        toolResult: expect.objectContaining({
          isError: false,
          content: expect.stringContaining('"ok": true'),
        }),
      }),
    ]);
  });

  it('tracks Codex interactive requests through receipt and rejection states', async () => {
    const harness = renderRealtimeHarness({ provider: 'codex' });

    await harness.emitMessage({
      type: 'codex-command-stdin-request',
      sessionId: 'session-1',
      requestId: 'stdin-1',
      toolName: 'CodexTerminalInput',
      input: {
        prompt: 'Enter stdin',
        processId: 'proc-1',
      },
    });

    expect(harness.result.current.pendingPermissionRequests).toEqual([
      expect.objectContaining({
        requestId: 'stdin-1',
        provider: 'codex',
        requestKind: 'terminal-stdin',
        toolName: 'CodexTerminalInput',
      }),
    ]);
    expect(harness.result.current.claudeStatus).toEqual({
      text: 'Waiting for terminal input',
      tokens: 0,
      can_interrupt: true,
    });

    await harness.emitMessage({
      type: 'codex-interactive-response-received',
      sessionId: 'session-1',
      requestId: 'stdin-1',
    });

    expect(harness.result.current.pendingPermissionRequests).toEqual([
      expect.objectContaining({
        requestId: 'stdin-1',
        deliveryState: 'processing',
        deliveryError: null,
      }),
    ]);

    await harness.emitMessage({
      type: 'codex-interactive-response-error',
      sessionId: 'session-1',
      requestId: 'stdin-1',
      error: 'Terminal refused input',
    });

    expect(harness.result.current.pendingPermissionRequests).toEqual([
      expect.objectContaining({
        requestId: 'stdin-1',
        deliveryState: 'failed',
        deliveryError: 'Terminal refused input',
      }),
    ]);
  });

  it('updates lifecycle state for Codex turns and navigates to completed sessions', async () => {
    sessionStorage.setItem('pendingSessionId', 'session-pending');
    localStorage.setItem(
      getChatMessagesStorageKey('demo-project', 'session-pending', 'codex'),
      JSON.stringify([{ type: 'assistant', content: 'stale-pending' }]),
    );
    localStorage.setItem(
      getChatMessagesStorageKey('demo-project', 'session-final', 'codex'),
      JSON.stringify([{ type: 'assistant', content: 'stale-final' }]),
    );
    const harness = renderRealtimeHarness({
      provider: 'codex',
      selectedSession: null,
      initialCurrentSessionId: null,
      pendingViewSession: { sessionId: 'session-pending', startedAt: Date.now() },
    });

    await harness.emitMessage({
      type: 'codex-response',
      sessionId: 'session-pending',
      data: { type: 'turn_started' },
    });

    expect(harness.result.current.isLoading).toBe(true);
    expect(harness.result.current.canAbortSession).toBe(true);
    expect(harness.result.current.claudeStatus).toEqual({
      text: 'Processing',
      tokens: 0,
      can_interrupt: true,
    });

    await harness.emitMessage({
      type: 'codex-complete',
      sessionId: 'session-pending',
      actualSessionId: 'session-final',
    });

    expect(sessionStorage.getItem('pendingSessionId')).toBeNull();
    expect(localStorage.getItem(getChatMessagesStorageKey('demo-project', 'session-pending', 'codex'))).toBeNull();
    expect(localStorage.getItem(getChatMessagesStorageKey('demo-project', 'session-final', 'codex'))).toBeNull();
    expect(harness.result.current.currentSessionId).toBe('session-final');
    expect(harness.result.current.isSystemSessionChange).toBe(true);
    expect(harness.callbacks.onNavigateToSession).toHaveBeenCalledWith('session-final');
  });

  it('appends a Codex completion notice when the turn ends without a final summary', async () => {
    const harness = renderRealtimeHarness({
      provider: 'codex',
      initialCurrentSessionId: 'session-1',
      initialIsLoading: true,
      initialCanAbortSession: true,
      initialClaudeStatus: { text: 'Processing', tokens: 0, can_interrupt: true },
      initialChatMessages: [
        {
          type: 'assistant',
          content: '我再看后端分页语义，确认 offset 方向。',
          timestamp: new Date('2026-03-20T14:29:50.948Z'),
        },
      ],
    });

    await harness.emitMessage({
      type: 'codex-complete',
      sessionId: 'session-1',
      actualSessionId: 'session-1',
      missingFinalSummary: true,
    });

    expect(harness.result.current.chatMessages).toEqual([
      expect.objectContaining({
        type: 'assistant',
        content: '我再看后端分页语义，确认 offset 方向。',
      }),
      expect.objectContaining({
        type: 'assistant',
        content: CODEX_MISSING_FINAL_SUMMARY_MESSAGE,
        isCodexCompletionNotice: true,
      }),
    ]);
    expect(harness.result.current.isLoading).toBe(false);
    expect(harness.result.current.canAbortSession).toBe(false);
  });

  it('clears pending session ids and appends a confirmation when a session is aborted', async () => {
    sessionStorage.setItem('pendingSessionId', 'session-1');
    const harness = renderRealtimeHarness({
      initialIsLoading: true,
      initialCanAbortSession: true,
      initialClaudeStatus: { text: 'Processing', tokens: 0, can_interrupt: true },
    });

    await harness.emitMessage({ type: 'session-aborted', sessionId: 'session-1', success: true });

    expect(sessionStorage.getItem('pendingSessionId')).toBeNull();
    expect(harness.result.current.chatMessages).toEqual([
      expect.objectContaining({ type: 'assistant', content: 'Session interrupted by user.' }),
    ]);
    expect(harness.result.current.isLoading).toBe(false);
    expect(harness.result.current.canAbortSession).toBe(false);
  });
});
