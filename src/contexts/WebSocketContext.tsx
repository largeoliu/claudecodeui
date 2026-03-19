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
  sendMessage: (message: unknown) => void;
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

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const messageListenersRef = useRef<Set<WebSocketMessageHandler>>(new Set());
  const unmountedRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
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

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const currentGeneration = ++generationRef.current;

    const wsUrl = buildWebSocketUrl(token);
    if (!wsUrl) {
      console.warn('[WS] No authentication token found for WebSocket connection');
      return;
    }

    if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) {
      wsRef.current.close();
    }

    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      if (unmountedRef.current || generationRef.current !== currentGeneration) {
        websocket.close();
        return;
      }
      reconnectAttemptRef.current = 0;
      wsRef.current = websocket;
      setIsConnected(true);
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WebSocketMessage;

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

      wsRef.current = null;
      setIsConnected(false);

      if (event.code === 1000 || event.code === 1001) {
        return;
      }

      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt), MAX_RECONNECT_DELAY_MS);
      reconnectAttemptRef.current = attempt + 1;

      console.log(`[WS] Connection closed (code ${event.code}), reconnecting in ${delay}ms (attempt ${attempt + 1})`);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (!unmountedRef.current && generationRef.current === currentGeneration) {
          connect();
        }
      }, delay);
    };

    websocket.onerror = (error) => {
      console.error('[WS] WebSocket error:', error);
    };
  }, [token]);

  useEffect(() => {
    unmountedRef.current = false;
    reconnectAttemptRef.current = 0;
    clearReconnectTimeout();
    connect();

    return () => {
      unmountedRef.current = true;
      clearReconnectTimeout();
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
      messageListenersRef.current.clear();
    };
  }, [connect, clearReconnectTimeout]);

  const sendMessage = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      console.warn('[WS] WebSocket not connected');
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
