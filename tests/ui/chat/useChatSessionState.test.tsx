// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const chatSessionStateMocks = vi.hoisted(() => ({
  sessionMessages: vi.fn(async () => ({
    ok: true,
    json: async () => ({ messages: [] }),
  })),
  authenticatedFetch: vi.fn(async () => ({
    ok: false,
    json: async () => ({}),
  })),
}));

vi.mock('../../../src/utils/api.js', () => ({
  api: {
    sessionMessages: chatSessionStateMocks.sessionMessages,
  },
  authenticatedFetch: chatSessionStateMocks.authenticatedFetch,
}));

import { useChatSessionState } from '../../../src/components/chat/hooks/useChatSessionState';
import { getChatMessagesStorageKey } from '../../../src/components/chat/utils/chatStorage';

const demoProject = {
  name: 'demo-project',
  displayName: 'Demo Project',
  fullPath: '/work/demo-project',
} as const;

function createHookProps(overrides: Record<string, unknown> = {}) {
  return {
    selectedProject: demoProject as any,
    selectedSession: { id: 'session-1', __provider: 'claude' } as any,
    ws: null,
    sendMessage: vi.fn(),
    autoScrollToBottom: true,
    externalMessageUpdate: 0,
    processingSessions: new Set(),
    resetStreamingState: vi.fn(),
    pendingViewSessionRef: { current: null },
    ...overrides,
  };
}

function renderSessionStateHook(overrides: Record<string, unknown> = {}) {
  const initialProps = createHookProps(overrides);

  return {
    initialProps,
    ...renderHook((props) => useChatSessionState(props as any), { initialProps }),
  };
}

function buildAssistantSessionMessage(content: string) {
  return {
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    },
    timestamp: '2026-03-20T00:00:00.000Z',
  };
}

describe('useChatSessionState', () => {
  beforeEach(() => {
    localStorage.clear();
    chatSessionStateMocks.sessionMessages.mockClear();
    chatSessionStateMocks.authenticatedFetch.mockClear();
  });

  it('hydrates persisted chat messages for the active session and expands the visible window on demand', () => {
    chatSessionStateMocks.sessionMessages.mockImplementation(() => new Promise(() => {}));

    const persistedMessages = Array.from({ length: 120 }, (_, index) => ({
      type: 'assistant',
      content: `message-${index}`,
      timestamp: index,
    }));
    localStorage.setItem(
      getChatMessagesStorageKey('demo-project', 'session-1', 'claude'),
      JSON.stringify(persistedMessages),
    );

    const { result } = renderSessionStateHook();

    expect(result.current.chatMessages).toHaveLength(120);
    expect(result.current.visibleMessages).toHaveLength(100);
    expect(result.current.visibleMessages[0]).toMatchObject({ content: 'message-20' });

    act(() => {
      result.current.loadEarlierMessages();
    });

    expect(result.current.visibleMessages).toHaveLength(120);
    expect(result.current.visibleMessages[0]).toMatchObject({ content: 'message-0' });
  });

  it('drops corrupted persisted chat state instead of crashing', () => {
    chatSessionStateMocks.sessionMessages.mockImplementation(() => new Promise(() => {}));

    const storageKey = getChatMessagesStorageKey('demo-project', 'session-1', 'claude');
    localStorage.setItem(storageKey, '{not-valid-json');

    const { result } = renderSessionStateHook();

    expect(result.current.chatMessages).toEqual([]);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('ignores stale session loads after switching to a different session', async () => {
    const resolvers = new Map<string, (response: { ok: boolean; json: () => Promise<unknown> }) => void>();

    chatSessionStateMocks.sessionMessages.mockImplementation(
      async (_projectName: string, sessionId: string) =>
        new Promise((resolve) => {
          resolvers.set(sessionId, resolve as (response: { ok: boolean; json: () => Promise<unknown> }) => void);
        }),
    );

    const { initialProps, result, rerender } = renderSessionStateHook({
      selectedSession: { id: 'session-a', __provider: 'claude' } as any,
    });

    await waitFor(() => {
      expect(resolvers.has('session-a')).toBe(true);
    });

    rerender({
      ...initialProps,
      selectedSession: { id: 'session-b', __provider: 'claude' } as any,
    });

    await waitFor(() => {
      expect(resolvers.has('session-b')).toBe(true);
    });

    await act(async () => {
      resolvers.get('session-a')?.({
        ok: true,
        json: async () => ({
          messages: [buildAssistantSessionMessage('from-session-a')],
        }),
      });
    });

    expect(result.current.chatMessages).toEqual([]);

    await act(async () => {
      resolvers.get('session-b')?.({
        ok: true,
        json: async () => ({
          messages: [buildAssistantSessionMessage('from-session-b')],
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.chatMessages).toEqual([
        expect.objectContaining({ type: 'assistant', content: 'from-session-b' }),
      ]);
    });
  });
});
