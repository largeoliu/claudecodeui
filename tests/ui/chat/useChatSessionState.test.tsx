// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
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

function renderSessionStateHook() {
  const selectedProject = {
    name: 'demo-project',
    displayName: 'Demo Project',
    fullPath: '/work/demo-project',
  } as any;
  const sendMessage = vi.fn();
  const resetStreamingState = vi.fn();
  const processingSessions = new Set();
  const pendingViewSessionRef = { current: null };

  return renderHook(() => useChatSessionState({
    selectedProject,
    selectedSession: { id: 'session-1', __provider: 'claude' } as any,
    ws: null,
    sendMessage,
    autoScrollToBottom: true,
    externalMessageUpdate: 0,
    processingSessions,
    resetStreamingState,
    pendingViewSessionRef,
  }));
}

describe('useChatSessionState', () => {
  beforeEach(() => {
    localStorage.clear();
    chatSessionStateMocks.sessionMessages.mockClear();
    chatSessionStateMocks.authenticatedFetch.mockClear();
  });

  it('hydrates persisted chat messages and expands the visible window on demand', () => {
    const persistedMessages = Array.from({ length: 120 }, (_, index) => ({
      type: 'assistant',
      content: `message-${index}`,
      timestamp: index,
    }));
    localStorage.setItem('chat_messages_demo-project', JSON.stringify(persistedMessages));

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
    localStorage.setItem('chat_messages_demo-project', '{not-valid-json');

    const { result } = renderSessionStateHook();

    expect(result.current.chatMessages).toEqual([]);
    expect(localStorage.getItem('chat_messages_demo-project')).toBeNull();
  });
});
