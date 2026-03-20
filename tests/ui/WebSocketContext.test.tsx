// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const webSocketContextMocks = vi.hoisted(() => ({
  isPlatform: false,
  token: 'auth-token',
  useAuth: vi.fn(),
}));

vi.mock('../../src/components/auth/context/AuthContext', () => ({
  useAuth: webSocketContextMocks.useAuth,
}));

vi.mock('../../src/constants/config', () => ({
  get IS_PLATFORM() {
    return webSocketContextMocks.isPlatform;
  },
}));

import {
  WebSocketProvider,
  useLatestWebSocketMessage,
  useWebSocket,
} from '../../src/contexts/WebSocketContext';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn((code = 1000, reason?: string) => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverClose(code = 1006) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

describe('WebSocketContext', () => {
  const OriginalWebSocket = globalThis.WebSocket;

  beforeAll(() => {
    (globalThis as any).WebSocket = MockWebSocket;
  });

  afterAll(() => {
    (globalThis as any).WebSocket = OriginalWebSocket;
  });

  beforeEach(() => {
    vi.useRealTimers();
    MockWebSocket.instances = [];
    webSocketContextMocks.isPlatform = false;
    webSocketContextMocks.token = 'auth-token';
    webSocketContextMocks.useAuth.mockImplementation(() => ({ token: webSocketContextMocks.token }));
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <WebSocketProvider>{children}</WebSocketProvider>;
  }

  it('connects with the auth token, publishes messages, and sends payloads through the socket', async () => {
    const { result } = renderHook(() => ({
      socket: useWebSocket(),
      latestChatMessage: useLatestWebSocketMessage<{ type: string; value?: number }>((message) => message.type === 'chat'),
    }), { wrapper });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('/ws?token=auth-token');

    act(() => {
      MockWebSocket.instances[0].open();
    });

    await waitFor(() => {
      expect(result.current.socket.isConnected).toBe(true);
    });

    act(() => {
      MockWebSocket.instances[0].receive({ type: 'ignored', value: 1 });
      MockWebSocket.instances[0].receive({ type: 'chat', value: 42 });
    });

    await waitFor(() => {
      expect(result.current.latestChatMessage).toEqual({ type: 'chat', value: 42 });
    });

    act(() => {
      result.current.socket.sendMessage({ kind: 'ping' });
    });

    expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith(JSON.stringify({ kind: 'ping' }));
  });

  it('reconnects with exponential backoff after unexpected closes', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    act(() => {
      MockWebSocket.instances[0].open();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      MockWebSocket.instances[0].serverClose(1006);
    });
    expect(result.current.isConnected).toBe(false);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(MockWebSocket.instances).toHaveLength(2);

    act(() => {
      MockWebSocket.instances[1].open();
    });
    expect(result.current.isConnected).toBe(true);
  });

  it('connects without a token in platform mode', async () => {
    webSocketContextMocks.isPlatform = true;
    webSocketContextMocks.token = null as any;

    const { result } = renderHook(() => useWebSocket(), { wrapper });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toMatch(/\/ws$/);

    act(() => {
      MockWebSocket.instances[0].open();
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });
  });
});
