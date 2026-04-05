import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';

type WebSocketMessage = {
  type?: string;
  [key: string]: unknown;
};

type WebSocketMessageHandler<TMessage = WebSocketMessage> = (message: TMessage) => void;
type WebSocketMessagePredicate<TMessage = WebSocketMessage> = (message: TMessage) => boolean;

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => boolean;
  isConnected: boolean;
  subscribeMessage: (handler: WebSocketMessageHandler) => () => void;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`;
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
};

const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const STALE_CONNECTION_TIMEOUT_MS = 75_000;
const STALE_CONNECTION_CHECK_INTERVAL_MS = 15_000;

const calculateReconnectDelay = (attempt: number) => {
  const cappedDelay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt), MAX_RECONNECT_DELAY_MS);
  const jitter = Math.floor(Math.random() * 250);
  return cappedDelay + jitter;
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const messageListenersRef = useRef<Set<WebSocketMessageHandler>>(new Set());
  const unmountedRef = useRef(false);
  const intentionalSocketClosuresRef = useRef(new WeakSet<WebSocket>());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const lastServerSeenAtRef = useRef(Date.now());
  const [isConnected, setIsConnected] = useState(false);
  const { token } = useAuth();

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const subscribeMessage = useCallback((handler: WebSocketMessageHandler) => {
    messageListenersRef.current.add(handler);

    return () => {
      messageListenersRef.current.delete(handler);
    };
  }, []);

  const connect = useCallback((force = false) => {
    if (unmountedRef.current) return;

    const wsUrl = buildWebSocketUrl(token);
    if (!wsUrl) {
      console.warn('[WS] No authentication token found for WebSocket connection');
      return;
    }

    const existingSocket = wsRef.current;
    if (existingSocket && !force) {
      if (existingSocket.readyState === WebSocket.CONNECTING || existingSocket.readyState === WebSocket.OPEN) {
        return;
      }
    }

    if (existingSocket && existingSocket.readyState < WebSocket.CLOSING) {
      intentionalSocketClosuresRef.current.add(existingSocket);
      existingSocket.close(1000, 'Reconnecting');
    }

    clearReconnectTimeout();

    const currentGeneration = ++generationRef.current;

    const websocket = new WebSocket(wsUrl);
    wsRef.current = websocket;

    websocket.onopen = () => {
      if (unmountedRef.current || generationRef.current !== currentGeneration) {
        intentionalSocketClosuresRef.current.add(websocket);
        websocket.close();
        return;
      }
      reconnectAttemptRef.current = 0;
      wsRef.current = websocket;
      lastServerSeenAtRef.current = Date.now();
      setIsConnected(true);
    };

    websocket.onmessage = (event) => {
      lastServerSeenAtRef.current = Date.now();

      try {
        const data = JSON.parse(event.data) as WebSocketMessage;
        if (data.type === 'heartbeat') {
          return;
        }

        messageListenersRef.current.forEach((listener) => {
          try {
            listener(data);
          } catch (listenerError) {
            console.error('[WS] Error in message listener:', listenerError);
          }
        });
      } catch (error) {
        console.error('[WS] Error parsing message:', error);
      }
    };

    websocket.onclose = (event) => {
      if (unmountedRef.current || generationRef.current !== currentGeneration) return;

      if (wsRef.current === websocket) {
        wsRef.current = null;
      }
      setIsConnected(false);

      if (intentionalSocketClosuresRef.current.has(websocket)) {
        intentionalSocketClosuresRef.current.delete(websocket);
        return;
      }

      const attempt = reconnectAttemptRef.current;
      const delay = calculateReconnectDelay(attempt);
      reconnectAttemptRef.current = attempt + 1;

      console.log(`[WS] Connection closed (code ${event.code}), reconnecting in ${delay}ms (attempt ${attempt + 1})`);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (!unmountedRef.current && generationRef.current === currentGeneration) {
          connect(true);
        }
      }, delay);
    };

    websocket.onerror = (error) => {
      console.error('[WS] WebSocket error:', error);
    };
  }, [clearReconnectTimeout, token]);

  useEffect(() => {
    unmountedRef.current = false;
    reconnectAttemptRef.current = 0;
    clearReconnectTimeout();
    connect(true);

    return () => {
      unmountedRef.current = true;
      clearReconnectTimeout();
      if (wsRef.current) {
        intentionalSocketClosuresRef.current.add(wsRef.current);
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
      messageListenersRef.current.clear();
    };
  }, [connect, clearReconnectTimeout]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (Date.now() - lastServerSeenAtRef.current <= STALE_CONNECTION_TIMEOUT_MS) {
        return;
      }

      console.warn('[WS] Connection appears stale, forcing reconnect');
      connect(true);
    }, STALE_CONNECTION_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [connect]);

  useEffect(() => {
    const maybeRecoverConnection = () => {
      if (unmountedRef.current) {
        return;
      }

      const socket = wsRef.current;
      const isSocketOpen = socket?.readyState === WebSocket.OPEN;
      const isSocketStale = isSocketOpen && Date.now() - lastServerSeenAtRef.current > STALE_CONNECTION_TIMEOUT_MS;

      if (!socket || socket.readyState === WebSocket.CLOSED || isSocketStale) {
        connect(Boolean(isSocketStale));
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        maybeRecoverConnection();
      }
    };

    window.addEventListener('online', maybeRecoverConnection);
    window.addEventListener('focus', maybeRecoverConnection);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', maybeRecoverConnection);
      window.removeEventListener('focus', maybeRecoverConnection);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connect]);

  const sendMessage = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('[WS] WebSocket not connected');
      return false;
    }

    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.warn('[WS] Failed to send WebSocket message:', error);
      return false;
    }
  }, []);

  const value: WebSocketContextType = useMemo(() => ({
      ws: wsRef.current,
      sendMessage,
      isConnected,
      subscribeMessage,
    }), [isConnected, sendMessage, subscribeMessage]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocketMessageSubscription = <TMessage = WebSocketMessage>(
  handler: WebSocketMessageHandler<TMessage>,
) => {
  const { subscribeMessage } = useWebSocket();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(
    () => subscribeMessage((message) => {
      handlerRef.current(message as TMessage);
    }),
    [subscribeMessage],
  );
};

export const useWebSocketMessageEffect = <TMessage = WebSocketMessage>(
  handler: WebSocketMessageHandler<TMessage>,
  predicate?: WebSocketMessagePredicate<TMessage>,
) => {
  const predicateRef = useRef(predicate);

  useEffect(() => {
    predicateRef.current = predicate;
  }, [predicate]);

  useWebSocketMessageSubscription<TMessage>((message) => {
    if (predicateRef.current && !predicateRef.current(message)) {
      return;
    }

    handler(message);
  });
};

export const useLatestWebSocketMessage = <TMessage = WebSocketMessage>(
  predicate?: WebSocketMessagePredicate<TMessage>,
) => {
  const [latestMessage, setLatestMessage] = useState<TMessage | null>(null);

  useWebSocketMessageEffect<TMessage>((message) => {
    setLatestMessage(message);
  }, predicate);

  return latestMessage;
};

export default WebSocketContext;
