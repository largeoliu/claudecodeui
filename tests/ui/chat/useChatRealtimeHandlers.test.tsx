// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import { useChatRealtimeHandlers } from '../../../src/components/chat/hooks/useChatRealtimeHandlers';
import type { ChatMessage, PendingPermissionRequest } from '../../../src/components/chat/types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../src/types/app';

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
    onNavigateToSession: vi.fn(),
    onWebSocketReconnect: vi.fn(),
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
