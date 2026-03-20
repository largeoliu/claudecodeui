import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { decodeHtmlEntities, formatUsageLimitText } from '../utils/chatFormatting';
import { safeLocalStorage } from '../utils/chatStorage';
import type { ChatMessage, PendingPermissionRequest } from '../types/types';
import {
  createPendingInteractiveRequest,
  mergePendingInteractiveRequests,
  setInteractiveRequestDeliveryState,
  upsertPendingInteractiveRequest,
} from '../utils/interactiveRequestTransport';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type LatestChatMessage = {
  type?: string;
  data?: any;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  code?: string;
  tool?: string;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  pendingPermissionRequests: PendingPermissionRequest[];
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onCodexSessionCreated?: (sessionId?: string | null) => void;
  onNavigateToSession?: (sessionId: string) => void;
  onWebSocketReconnect?: () => void;
  onCodexInteractiveRequestSettled?: () => void;
}

const appendStreamingChunk = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  chunk: string,
  newline = false,
) => {
  if (!chunk) {
    return;
  }

  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
      const nextContent = newline
        ? last.content
          ? `${last.content}\n${chunk}`
          : chunk
        : `${last.content || ''}${chunk}`;
      // Clone the message instead of mutating in place so React can reliably detect state updates.
      updated[lastIndex] = { ...last, content: nextContent };
    } else {
      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
    }
    return updated;
  });
};

const finalizeStreamingMessage = (setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>) => {
  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && last.isStreaming) {
      // Clone the message instead of mutating in place so React can reliably detect state updates.
      updated[lastIndex] = { ...last, isStreaming: false };
    }
    return updated;
  });
};

const parseMaybeJson = (value: unknown) => {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const normalizeCodexToolName = (value: unknown) => {
  if (value === 'shell_command') {
    return 'Bash';
  }

  return typeof value === 'string' && value ? value : 'UnknownTool';
};

const normalizeCodexToolInput = (toolName: string, value: unknown) => {
  const parsedValue = parseMaybeJson(value);

  if (toolName === 'Bash' && typeof parsedValue === 'string') {
    return { command: parsedValue };
  }

  return parsedValue;
};

const toCodexToolResult = (value: unknown, isError = false) => ({
  content:
    typeof value === 'string'
      ? value
      : value === undefined || value === null
        ? ''
        : JSON.stringify(value, null, 2),
  isError,
  timestamp: new Date(),
});

const upsertCodexToolMessage = ({
  setChatMessages,
  toolId,
  toolName,
  toolInput,
  toolResult,
}: {
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  toolId: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: { content?: unknown; isError?: boolean; timestamp?: Date | string | number } | null;
}) => {
  setChatMessages((previous) => {
    const existingIndex = previous.findIndex((message) => message.isToolUse && message.toolId === toolId);

    if (existingIndex === -1) {
      return [
        ...previous,
        {
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          isToolUse: true,
          toolName: toolName || 'UnknownTool',
          toolInput: toolInput ?? '',
          toolId,
          toolResult: toolResult ?? null,
        },
      ];
    }

    const next = [...previous];
    const existingMessage = next[existingIndex];

    next[existingIndex] = {
      ...existingMessage,
      toolName: toolName || existingMessage.toolName,
      toolInput: toolInput !== undefined ? toolInput : existingMessage.toolInput,
      toolResult: toolResult !== undefined ? toolResult : existingMessage.toolResult,
    };

    return next;
  });
};

const upsertCodexTextMessage = ({
  setChatMessages,
  itemId,
  content,
  isThinking = false,
  isStreaming = false,
}: {
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  itemId: string;
  content: string;
  isThinking?: boolean;
  isStreaming?: boolean;
}) => {
  setChatMessages((previous) => {
    const existingIndex = previous.findIndex(
      (message) =>
        !message.isToolUse
        && message.toolId === itemId
        && Boolean(message.isThinking) === isThinking,
    );

    if (existingIndex === -1) {
      return [
        ...previous,
        {
          type: 'assistant',
          content,
          timestamp: new Date(),
          isThinking,
          isStreaming,
          toolId: itemId,
        },
      ];
    }

    const next = [...previous];
    next[existingIndex] = {
      ...next[existingIndex],
      content,
      isThinking,
      isStreaming,
      timestamp: new Date(),
    };
    return next;
  });
};

const appendCodexTextDelta = ({
  setChatMessages,
  itemId,
  delta,
  isThinking = false,
}: {
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  itemId: string;
  delta: string;
  isThinking?: boolean;
}) => {
  if (!delta) {
    return;
  }

  setChatMessages((previous) => {
    const existingIndex = previous.findIndex(
      (message) =>
        !message.isToolUse
        && message.toolId === itemId
        && Boolean(message.isThinking) === isThinking,
    );

    if (existingIndex === -1) {
      return [
        ...previous,
        {
          type: 'assistant',
          content: delta,
          timestamp: new Date(),
          isThinking,
          isStreaming: true,
          toolId: itemId,
        },
      ];
    }

    const next = [...previous];
    const existingMessage = next[existingIndex];
    next[existingIndex] = {
      ...existingMessage,
      content: `${existingMessage.content || ''}${delta}`,
      isThinking,
      isStreaming: true,
      timestamp: new Date(),
    };
    return next;
  });
};

const appendCodexToolResultChunk = ({
  setChatMessages,
  toolId,
  toolName,
  toolInput,
  chunk,
}: {
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  toolId: string;
  toolName?: string;
  toolInput?: unknown;
  chunk: string;
}) => {
  if (!chunk) {
    return;
  }

  setChatMessages((previous) => {
    const existingIndex = previous.findIndex((message) => message.isToolUse && message.toolId === toolId);

    if (existingIndex === -1) {
      return [
        ...previous,
        {
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          isToolUse: true,
          toolName: toolName || 'UnknownTool',
          toolInput: toolInput ?? '',
          toolId,
          toolResult: {
            content: chunk,
            isError: false,
            timestamp: new Date(),
          },
        },
      ];
    }

    const next = [...previous];
    const existingMessage = next[existingIndex];
    const previousContent =
      typeof existingMessage.toolResult?.content === 'string'
        ? existingMessage.toolResult.content
        : '';
    next[existingIndex] = {
      ...existingMessage,
      toolName: toolName || existingMessage.toolName,
      toolInput: toolInput !== undefined ? toolInput : existingMessage.toolInput,
      toolResult: {
        ...(existingMessage.toolResult || {}),
        content: `${previousContent}${chunk}`,
        isError: false,
        timestamp: new Date(),
      },
    };
    return next;
  });
};

export function useChatRealtimeHandlers({
  latestMessage,
  provider,
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
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onReplaceTemporarySession,
  onCodexSessionCreated,
  onNavigateToSession,
  onWebSocketReconnect,
  onCodexInteractiveRequestSettled,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    // Guard against duplicate processing when dependency updates occur without a new message object.
    if (lastProcessedMessageRef.current === latestMessage) {
      return;
    }
    lastProcessedMessageRef.current = latestMessage;

    const messageData = latestMessage.data?.message || latestMessage.data;
    const structuredMessageData =
      messageData && typeof messageData === 'object' ? (messageData as Record<string, any>) : null;
    const rawStructuredData =
      latestMessage.data && typeof latestMessage.data === 'object'
        ? (latestMessage.data as Record<string, any>)
        : null;
    const messageType = String(latestMessage.type);

    const globalMessageTypes = ['projects_updated', 'taskmaster-project-updated', 'session-created', 'websocket-reconnected'];
    const isGlobalMessage = globalMessageTypes.includes(messageType);
    const lifecycleMessageTypes = new Set([
      'claude-complete',
      'codex-complete',
      'cursor-result',
      'session-aborted',
      'claude-error',
      'cursor-error',
      'codex-error',
      'gemini-error',
      'error',
    ]);

    const isClaudeSystemInit =
      latestMessage.type === 'claude-response' &&
      structuredMessageData &&
      structuredMessageData.type === 'system' &&
      structuredMessageData.subtype === 'init';

    const isCursorSystemInit =
      latestMessage.type === 'cursor-system' &&
      rawStructuredData &&
      rawStructuredData.type === 'system' &&
      rawStructuredData.subtype === 'init';

    const systemInitSessionId = isClaudeSystemInit
      ? structuredMessageData?.session_id
      : isCursorSystemInit
        ? rawStructuredData?.session_id
        : null;

    const activeViewSessionId =
      selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;
    const hasPendingUnboundSession =
      Boolean(pendingViewSessionRef.current) && !pendingViewSessionRef.current?.sessionId;
    const isSystemInitForView =
      systemInitSessionId && (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
    const isInteractiveResponseForPendingRequest =
      Boolean(latestMessage.requestId)
      && (
        latestMessage.type === 'codex-interactive-response-received'
        || latestMessage.type === 'codex-interactive-response-ack'
        || latestMessage.type === 'codex-interactive-response-error'
      )
      && pendingPermissionRequests.some((request) => request.requestId === latestMessage.requestId);
    const shouldBypassSessionFilter =
      isGlobalMessage || Boolean(isSystemInitForView) || isInteractiveResponseForPendingRequest;
    const isLifecycleMessage = lifecycleMessageTypes.has(messageType);
    const isUnscopedError =
      !latestMessage.sessionId &&
      pendingViewSessionRef.current &&
      !pendingViewSessionRef.current.sessionId &&
      (latestMessage.type === 'claude-error' ||
        latestMessage.type === 'cursor-error' ||
        latestMessage.type === 'codex-error' ||
        latestMessage.type === 'gemini-error');

    const handleBackgroundLifecycle = (sessionId?: string) => {
      if (!sessionId) {
        return;
      }
      onSessionInactive?.(sessionId);
      onSessionNotProcessing?.(sessionId);
    };

    const collectSessionIds = (...sessionIds: Array<string | null | undefined>) =>
      Array.from(
        new Set(
          sessionIds.filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
        ),
      );

    const clearLoadingIndicators = () => {
      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
    };

    const clearPendingViewSession = (resolvedSessionId?: string | null) => {
      const pendingSession = pendingViewSessionRef.current;
      if (!pendingSession) {
        return;
      }

      // If the in-view request never received a concrete session ID (or this terminal event
      // resolves the same pending session), clear it to avoid stale "in-flight" UI state.
      if (!pendingSession.sessionId || !resolvedSessionId || pendingSession.sessionId === resolvedSessionId) {
        pendingViewSessionRef.current = null;
      }
    };

    const flushStreamingState = () => {
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      const pendingChunk = streamBufferRef.current;
      streamBufferRef.current = '';
      appendStreamingChunk(setChatMessages, pendingChunk, false);
      finalizeStreamingMessage(setChatMessages);
    };

    const markSessionsAsCompleted = (...sessionIds: Array<string | null | undefined>) => {
      const normalizedSessionIds = collectSessionIds(...sessionIds);
      normalizedSessionIds.forEach((sessionId) => {
        onSessionInactive?.(sessionId);
        onSessionNotProcessing?.(sessionId);
      });
    };

    const finalizeLifecycleForCurrentView = (...sessionIds: Array<string | null | undefined>) => {
      const pendingSessionId = typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
      const resolvedSessionIds = collectSessionIds(...sessionIds, pendingSessionId, pendingViewSessionRef.current?.sessionId);
      const resolvedPrimarySessionId = resolvedSessionIds[0] || null;

      flushStreamingState();
      clearLoadingIndicators();
      markSessionsAsCompleted(...resolvedSessionIds);
      setPendingPermissionRequests([]);
      clearPendingViewSession(resolvedPrimarySessionId);
    };

    if (!shouldBypassSessionFilter) {
      if (!activeViewSessionId) {
        if (latestMessage.sessionId && isLifecycleMessage && !hasPendingUnboundSession) {
          handleBackgroundLifecycle(latestMessage.sessionId);
          return;
        }
        if (!isUnscopedError && !hasPendingUnboundSession) {
          return;
        }
      }

      if (!latestMessage.sessionId && !isUnscopedError && !hasPendingUnboundSession) {
        return;
      }

      if (latestMessage.sessionId !== activeViewSessionId) {
        const shouldTreatAsPendingViewLifecycle =
          !activeViewSessionId &&
          hasPendingUnboundSession &&
          latestMessage.sessionId &&
          isLifecycleMessage;

        if (!shouldTreatAsPendingViewLifecycle) {
          if (latestMessage.sessionId && isLifecycleMessage) {
            handleBackgroundLifecycle(latestMessage.sessionId);
          }
          return;
        }
      }
    }

    switch (latestMessage.type) {
      case 'session-created':
        if (latestMessage.sessionId && !currentSessionId) {
          sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
          if (pendingViewSessionRef.current && !pendingViewSessionRef.current.sessionId) {
            pendingViewSessionRef.current.sessionId = latestMessage.sessionId;
          }

          setIsSystemSessionChange(true);
          onReplaceTemporarySession?.(latestMessage.sessionId);
          if (provider === 'codex') {
            onCodexSessionCreated?.(latestMessage.sessionId);
          }

          setPendingPermissionRequests((previous) =>
            previous.map((request) =>
              request.sessionId ? request : { ...request, sessionId: latestMessage.sessionId },
            ),
          );
        }
        break;

      case 'websocket-reconnected':
        // WebSocket dropped and reconnected — re-fetch session history to catch up on missed messages
        onWebSocketReconnect?.();
        break;

      case 'token-budget':
        if (latestMessage.data) {
          setTokenBudget(latestMessage.data);
        }
        break;

      case 'claude-response': {
        if (messageData && typeof messageData === 'object' && messageData.type) {
          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            streamBufferRef.current += decodedText;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 100);
            }
            return;
          }

          if (messageData.type === 'content_block_stop') {
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';
            appendStreamingChunk(setChatMessages, chunk, false);
            finalizeStreamingMessage(setChatMessages);
            return;
          }
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          currentSessionId &&
          structuredMessageData.session_id !== currentSessionId &&
          isSystemInitForView
        ) {
          setIsSystemSessionChange(true);
          onNavigateToSession?.(structuredMessageData.session_id);
          return;
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          !currentSessionId &&
          isSystemInitForView
        ) {
          setIsSystemSessionChange(true);
          onNavigateToSession?.(structuredMessageData.session_id);
          return;
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          currentSessionId &&
          structuredMessageData.session_id === currentSessionId &&
          isSystemInitForView
        ) {
          return;
        }

        if (structuredMessageData && Array.isArray(structuredMessageData.content)) {
          const parentToolUseId = rawStructuredData?.parentToolUseId;

          structuredMessageData.content.forEach((part: any) => {
            if (part.type === 'tool_use') {
              const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';

              // Check if this is a child tool from a subagent
              if (parentToolUseId) {
                setChatMessages((previous) =>
                  previous.map((message) => {
                    if (message.toolId === parentToolUseId && message.isSubagentContainer) {
                      const childTool = {
                        toolId: part.id,
                        toolName: part.name,
                        toolInput: part.input,
                        toolResult: null,
                        timestamp: new Date(),
                      };
                      const existingChildren = message.subagentState?.childTools || [];
                      return {
                        ...message,
                        subagentState: {
                          childTools: [...existingChildren, childTool],
                          currentToolIndex: existingChildren.length,
                          isComplete: false,
                        },
                      };
                    }
                    return message;
                  }),
                );
                return;
              }

              // Check if this is a Task tool (subagent container)
              const isSubagentContainer = part.name === 'Task';

              setChatMessages((previous) => [
                ...previous,
                {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: part.name,
                  toolInput,
                  toolId: part.id,
                  toolResult: null,
                  isSubagentContainer,
                  subagentState: isSubagentContainer
                    ? { childTools: [], currentToolIndex: -1, isComplete: false }
                    : undefined,
                },
              ]);
              return;
            }

            if (part.type === 'text' && part.text?.trim()) {
              let content = decodeHtmlEntities(part.text);
              content = formatUsageLimitText(content);
              setChatMessages((previous) => [
                ...previous,
                {
                  type: 'assistant',
                  content,
                  timestamp: new Date(),
                },
              ]);
            }
          });
        } else if (structuredMessageData && typeof structuredMessageData.content === 'string' && structuredMessageData.content.trim()) {
          let content = decodeHtmlEntities(structuredMessageData.content);
          content = formatUsageLimitText(content);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content,
              timestamp: new Date(),
            },
          ]);
        }

        if (structuredMessageData?.role === 'user' && Array.isArray(structuredMessageData.content)) {
          const parentToolUseId = rawStructuredData?.parentToolUseId;

          structuredMessageData.content.forEach((part: any) => {
            if (part.type !== 'tool_result') {
              return;
            }

            setChatMessages((previous) =>
              previous.map((message) => {
                // Handle child tool results (route to parent's subagentState)
                if (parentToolUseId && message.toolId === parentToolUseId && message.isSubagentContainer) {
                  return {
                    ...message,
                    subagentState: {
                      ...message.subagentState!,
                      childTools: message.subagentState!.childTools.map((child) => {
                        if (child.toolId === part.tool_use_id) {
                          return {
                            ...child,
                            toolResult: {
                              content: part.content,
                              isError: part.is_error,
                              timestamp: new Date(),
                            },
                          };
                        }
                        return child;
                      }),
                    },
                  };
                }

                // Handle normal tool results (including parent Task tool completion)
                if (message.isToolUse && message.toolId === part.tool_use_id) {
                  const result = {
                    ...message,
                    toolResult: {
                      content: part.content,
                      isError: part.is_error,
                      timestamp: new Date(),
                    },
                  };
                  // Mark subagent as complete when parent Task receives its result
                  if (message.isSubagentContainer && message.subagentState) {
                    result.subagentState = {
                      ...message.subagentState,
                      isComplete: true,
                    };
                  }
                  return result;
                }
                return message;
              }),
            );
          });
        }
        break;
      }

      case 'claude-output': {
        const cleaned = String(latestMessage.data || '');
        if (cleaned.trim()) {
          streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
          if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;
              appendStreamingChunk(setChatMessages, chunk, true);
            }, 100);
          }
        }
        break;
      }

      case 'claude-interactive-prompt':
        // Interactive prompts are parsed/rendered as text in the UI.
        // Normalize to string to keep ChatMessage.content shape consistent.
        {
          const interactiveContent =
            typeof latestMessage.data === 'string'
              ? latestMessage.data
              : JSON.stringify(latestMessage.data ?? '', null, 2);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: interactiveContent,
              timestamp: new Date(),
              isInteractivePrompt: true,
            },
          ]);
        }
        break;

      case 'claude-permission-request':
        if (provider !== 'claude' || !latestMessage.requestId) {
          break;
        }
        {
          const requestId = latestMessage.requestId;

          setPendingPermissionRequests((previous) => {
            if (previous.some((request) => request.requestId === requestId)) {
              return previous;
            }
            return upsertPendingInteractiveRequest(previous, {
              requestId,
              toolName: latestMessage.toolName || 'UnknownTool',
              input: latestMessage.input,
              context: latestMessage.context,
              sessionId: latestMessage.sessionId || null,
              receivedAt: new Date(),
            });
          });
        }

        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({
          text: 'Waiting for permission',
          tokens: 0,
          can_interrupt: true,
        });
        break;

      case 'claude-permission-cancelled':
        if (!latestMessage.requestId) {
          break;
        }
        setPendingPermissionRequests((previous) =>
          previous.filter((request) => request.requestId !== latestMessage.requestId),
        );
        break;

      case 'claude-error':
        finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: `Error: ${latestMessage.error}`,
            timestamp: new Date(),
          },
        ]);
        break;

      case 'cursor-system':
        try {
          const cursorData = latestMessage.data;
          if (
            cursorData &&
            cursorData.type === 'system' &&
            cursorData.subtype === 'init' &&
            cursorData.session_id
          ) {
            if (!isSystemInitForView) {
              return;
            }

            if (currentSessionId && cursorData.session_id !== currentSessionId) {
              setIsSystemSessionChange(true);
              onNavigateToSession?.(cursorData.session_id);
              return;
            }

            if (!currentSessionId) {
              setIsSystemSessionChange(true);
              onNavigateToSession?.(cursorData.session_id);
              return;
            }
          }
        } catch (error) {
          console.warn('Error handling cursor-system message:', error);
        }
        break;

      case 'cursor-user':
        break;

      case 'cursor-tool-use':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: `Using tool: ${latestMessage.tool} ${latestMessage.input ? `with ${latestMessage.input}` : ''
              }`,
            timestamp: new Date(),
            isToolUse: true,
            toolName: latestMessage.tool,
            toolInput: latestMessage.input,
          },
        ]);
        break;

      case 'cursor-error':
        finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: `Cursor error: ${latestMessage.error || 'Unknown error'}`,
            timestamp: new Date(),
          },
        ]);
        break;

      case 'cursor-result': {
        const cursorCompletedSessionId = latestMessage.sessionId || currentSessionId;
        const pendingCursorSessionId = sessionStorage.getItem('pendingSessionId');

        finalizeLifecycleForCurrentView(
          cursorCompletedSessionId,
          currentSessionId,
          selectedSession?.id,
          pendingCursorSessionId,
        );

        try {
          const resultData = latestMessage.data || {};
          const textResult = typeof resultData.result === 'string' ? resultData.result : '';

          if (streamTimerRef.current) {
            clearTimeout(streamTimerRef.current);
            streamTimerRef.current = null;
          }
          const pendingChunk = streamBufferRef.current;
          streamBufferRef.current = '';

          setChatMessages((previous) => {
            const updated = [...previous];
            const lastIndex = updated.length - 1;
            const last = updated[lastIndex];
            const normalizedTextResult = textResult.trim();

            if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
              const finalContent =
                normalizedTextResult
                  ? textResult
                  : `${last.content || ''}${pendingChunk || ''}`;
              // Clone the message instead of mutating in place so React can reliably detect state updates.
              updated[lastIndex] = { ...last, content: finalContent, isStreaming: false };
            } else if (normalizedTextResult) {
              const lastAssistantText =
                last && last.type === 'assistant' && !last.isToolUse
                  ? String(last.content || '').trim()
                  : '';

              // Cursor can emit the same final text through both streaming and result payloads.
              // Skip adding a second assistant bubble when the final text is unchanged.
              const isDuplicateFinalText = lastAssistantText === normalizedTextResult;
              if (isDuplicateFinalText) {
                return updated;
              }

              updated.push({
                type: resultData.is_error ? 'error' : 'assistant',
                content: textResult,
                timestamp: new Date(),
                isStreaming: false,
              });
            }
            return updated;
          });
        } catch (error) {
          console.warn('Error handling cursor-result message:', error);
        }

        if (cursorCompletedSessionId && !currentSessionId && cursorCompletedSessionId === pendingCursorSessionId) {
          setCurrentSessionId(cursorCompletedSessionId);
          sessionStorage.removeItem('pendingSessionId');
          if (window.refreshProjects) {
            setTimeout(() => window.refreshProjects?.(), 500);
          }
        }
        break;
      }

      case 'cursor-output':
        try {
          const raw = String(latestMessage.data ?? '');
          const cleaned = raw
            .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .trim();

          if (cleaned) {
            streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, true);
              }, 100);
            }
          }
        } catch (error) {
          console.warn('Error handling cursor-output message:', error);
        }
        break;

      case 'claude-complete': {
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        const completedSessionId =
          latestMessage.sessionId || currentSessionId || pendingSessionId;

        finalizeLifecycleForCurrentView(
          completedSessionId,
          currentSessionId,
          selectedSession?.id,
          pendingSessionId,
        );

        if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          sessionStorage.removeItem('pendingSessionId');
          console.log('New session complete, ID set to:', pendingSessionId);
        }

        if (selectedProject && latestMessage.exitCode === 0) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        break;
      }

      case 'codex-response': {
        const codexData = latestMessage.data;
        if (!codexData) {
          break;
        }

        if (codexData.type === 'item') {
          switch (codexData.itemType) {
            case 'agent_message': {
              const content = typeof codexData.message?.content === 'string'
                ? decodeHtmlEntities(codexData.message.content)
                : '';

              if (content.trim() && codexData.itemId) {
                upsertCodexTextMessage({
                  setChatMessages,
                  itemId: codexData.itemId,
                  content,
                  isStreaming: Boolean(codexData.isPartial),
                });
              }
              break;
            }

            case 'agent_message_delta':
              if (codexData.itemId) {
                appendCodexTextDelta({
                  setChatMessages,
                  itemId: codexData.itemId,
                  delta: decodeHtmlEntities(String(codexData.delta || '')),
                });
              }
              break;

            case 'reasoning': {
              const content = typeof codexData.message?.content === 'string'
                ? decodeHtmlEntities(codexData.message.content)
                : '';

              if (content.trim() && codexData.itemId) {
                upsertCodexTextMessage({
                  setChatMessages,
                  itemId: codexData.itemId,
                  content,
                  isThinking: true,
                  isStreaming: Boolean(codexData.isPartial),
                });
              }
              break;
            }

            case 'reasoning_delta':
              if (codexData.itemId) {
                appendCodexTextDelta({
                  setChatMessages,
                  itemId: codexData.itemId,
                  delta: decodeHtmlEntities(String(codexData.delta || '')),
                  isThinking: true,
                });
              }
              break;

            case 'reasoning_summary_part':
              break;

            case 'command_execution': {
              if (!codexData.itemId || !codexData.command) {
                break;
              }

              const toolResult =
                codexData.output || codexData.exitCode !== null
                  ? {
                      content: codexData.output || `Exit code: ${codexData.exitCode}`,
                      isError:
                        codexData.status === 'failed'
                        || (typeof codexData.exitCode === 'number' && codexData.exitCode !== 0),
                      timestamp: new Date(),
                    }
                  : undefined;

              upsertCodexToolMessage({
                setChatMessages,
                toolId: codexData.itemId,
                toolName: 'Bash',
                toolInput: {
                  command: codexData.command,
                  cwd: codexData.cwd,
                },
                toolResult,
              });
              break;
            }

            case 'command_execution_delta':
              if (codexData.itemId) {
                appendCodexToolResultChunk({
                  setChatMessages,
                  toolId: codexData.itemId,
                  toolName: 'Bash',
                  chunk: String(codexData.delta || ''),
                });
              }
              break;

            case 'file_change': {
              if (!codexData.itemId || !Array.isArray(codexData.changes) || codexData.changes.length === 0) {
                break;
              }

              const changesList = codexData.changes
                .map((change: { kind?: { type?: string } | string; path?: string }) => {
                  const kind =
                    typeof change.kind === 'string'
                      ? change.kind
                      : change.kind?.type || 'update';
                  return `${kind}: ${change.path || ''}`;
                })
                .join('\n');

              upsertCodexToolMessage({
                setChatMessages,
                toolId: codexData.itemId,
                toolName: 'Edit',
                toolInput: changesList,
                toolResult: codexData.phase === 'completed'
                  ? {
                      content: `Status: ${codexData.status}`,
                      isError: codexData.status === 'failed',
                      timestamp: new Date(),
                    }
                  : undefined,
              });
              break;
            }

            case 'mcp_tool_call':
              upsertCodexToolMessage({
                setChatMessages,
                toolId: codexData.itemId || `mcp-${Date.now()}`,
                toolName: `${codexData.server}:${codexData.tool}`,
                toolInput: codexData.arguments,
                toolResult:
                  codexData.phase === 'completed'
                    ? toCodexToolResult(
                        codexData.result ?? codexData.error?.message ?? `Status: ${codexData.status}`,
                        Boolean(codexData.error),
                      )
                    : undefined,
              });
              break;

            case 'dynamic_tool_call': {
              const toolId = codexData.itemId || `dynamic-tool-${Date.now()}`;
              const toolName = normalizeCodexToolName(codexData.tool);

              upsertCodexToolMessage({
                setChatMessages,
                toolId,
                toolName,
                toolInput: normalizeCodexToolInput(toolName, codexData.arguments),
                toolResult:
                  codexData.phase === 'completed'
                    ? toCodexToolResult(
                        codexData.output || `Status: ${codexData.status || 'completed'}`,
                        codexData.success === false || codexData.status === 'failed',
                      )
                    : undefined,
              });
              break;
            }

            case 'collab_agent_tool_call':
              upsertCodexToolMessage({
                setChatMessages,
                toolId: codexData.itemId || `collab-tool-${Date.now()}`,
                toolName: codexData.tool === 'spawnAgent' ? 'Task' : codexData.tool,
                toolInput: {
                  prompt: codexData.prompt,
                  model: codexData.model,
                  reasoningEffort: codexData.reasoningEffort,
                  receiverThreadIds: codexData.receiverThreadIds,
                },
                toolResult:
                  codexData.phase === 'completed'
                    ? toCodexToolResult(
                        codexData.agentsStates || `Status: ${codexData.status || 'completed'}`,
                        codexData.status === 'failed',
                      )
                    : undefined,
              });
              break;

            case 'todo_list': {
              const plan = Array.isArray(codexData.items)
                ? codexData.items.map((item: any, index: number) => ({
                    id: typeof item?.id === 'string' ? item.id : `codex-plan-${index}`,
                    step:
                      typeof item?.step === 'string'
                        ? item.step
                        : typeof item?.content === 'string'
                          ? item.content
                          : typeof item?.text === 'string'
                            ? item.text
                            : `Step ${index + 1}`,
                    status: typeof item?.status === 'string' ? item.status : 'pending',
                    priority: typeof item?.priority === 'string' ? item.priority : undefined,
                  }))
                : [];

              upsertCodexToolMessage({
                setChatMessages,
                toolId: codexData.itemId || 'codex-plan',
                toolName: 'update_plan',
                toolInput: {
                  explanation: codexData.explanation,
                  plan,
                },
              });
              break;
            }

            case 'plan_text':
              if (typeof codexData.text === 'string' && codexData.text.trim()) {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content: decodeHtmlEntities(codexData.text),
                    timestamp: new Date(),
                  },
                ]);
              }
              break;

            case 'web_search':
              upsertCodexToolMessage({
                setChatMessages,
                toolId: codexData.itemId || `web-search-${Date.now()}`,
                toolName: 'web_search',
                toolInput: {
                  query: codexData.query,
                  action: codexData.action,
                },
              });
              break;

            case 'function_call':
            case 'custom_tool_call': {
              const toolItem = codexData.item || {};
              const toolName = normalizeCodexToolName(toolItem.name || codexData.name);
              const toolId = toolItem.call_id || toolItem.id || `codex-tool-${Date.now()}`;
              const toolInput = normalizeCodexToolInput(
                toolName,
                toolItem.arguments ?? toolItem.input ?? codexData.arguments ?? codexData.input,
              );

              upsertCodexToolMessage({
                setChatMessages,
                toolId,
                toolName,
                toolInput,
                toolResult: toolItem.error
                  ? toCodexToolResult(toolItem.error, true)
                  : undefined,
              });
              break;
            }

            case 'function_call_output':
            case 'custom_tool_call_output': {
              const toolItem = codexData.item || {};
              const toolId = toolItem.call_id || toolItem.id;

              if (!toolId) {
                break;
              }

              const output = toolItem.output ?? toolItem.result ?? toolItem.content ?? `Status: ${toolItem.status || 'completed'}`;

              upsertCodexToolMessage({
                setChatMessages,
                toolId,
                toolResult: toCodexToolResult(output, Boolean(toolItem.error)),
              });
              break;
            }

            case 'error':
              if (codexData.message?.content) {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'error',
                    content: codexData.message.content,
                    timestamp: new Date(),
                  },
                ]);
              }
              break;

            default:
              console.log('[Codex] Unhandled item type:', codexData.itemType, codexData);
          }
        }

        if (codexData.type === 'turn_started') {
          setIsLoading(true);
          setCanAbortSession(true);
          setClaudeStatus({
            text: 'Processing',
            tokens: 0,
            can_interrupt: true,
          });
        }

        if (codexData.type === 'turn_complete') {
          finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        }

        if (codexData.type === 'turn_failed') {
          finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error',
              content: codexData.error?.message || 'Turn failed',
              timestamp: new Date(),
            },
          ]);
        }
        break;
      }

      case 'codex-approval-request':
      case 'codex-user-input-request':
      case 'codex-command-stdin-request':
        if (!latestMessage.requestId) {
          break;
        }
        {
          const requestId = latestMessage.requestId;

          setPendingPermissionRequests((previous) => {
            if (previous.some((request) => request.requestId === requestId)) {
              return previous;
            }

            return upsertPendingInteractiveRequest(previous, {
              requestId,
              provider: 'codex',
              requestKind: latestMessage.requestKind || (
                latestMessage.type === 'codex-user-input-request'
                  ? 'user-input'
                  : latestMessage.type === 'codex-command-stdin-request'
                    ? 'terminal-stdin'
                    : 'approval'
              ),
              toolName: latestMessage.toolName || 'UnknownTool',
              input: latestMessage.input,
              context: latestMessage.context,
              sessionId: latestMessage.sessionId || null,
              receivedAt: new Date(),
            });
          });

          setIsLoading(true);
          setCanAbortSession(true);
          setClaudeStatus({
            text:
              latestMessage.type === 'codex-user-input-request'
                ? 'Waiting for input'
                : latestMessage.type === 'codex-command-stdin-request'
                  ? 'Waiting for terminal input'
                  : 'Waiting for permission',
            tokens: 0,
            can_interrupt: true,
          });
        }
        break;

      case 'codex-request-cancelled':
        if (!latestMessage.requestId) {
          break;
        }
        setPendingPermissionRequests((previous) =>
          previous.filter((request) => request.requestId !== latestMessage.requestId),
        );
        break;

      case 'codex-interactive-response-received':
        if (!latestMessage.requestId) {
          break;
        }
        {
          const requestId = latestMessage.requestId;
          setPendingPermissionRequests((previous) =>
            setInteractiveRequestDeliveryState(previous, requestId, 'processing'),
          );
        }
        break;

      case 'codex-interactive-response-ack':
        if (!latestMessage.requestId) {
          break;
        }
        setPendingPermissionRequests((previous) =>
          previous.filter((request) => request.requestId !== latestMessage.requestId),
        );
        onCodexInteractiveRequestSettled?.();
        break;

      case 'codex-interactive-response-error':
        if (!latestMessage.requestId) {
          break;
        }
        {
          const requestId = latestMessage.requestId;
          if (latestMessage.code === 'not_found') {
            setPendingPermissionRequests((previous) =>
              previous.filter((request) => request.requestId !== requestId),
            );
            setChatMessages((previous) => [
              ...previous,
              {
                type: 'error',
                content: 'This Codex request expired before it could be applied. The session has been refreshed.',
                timestamp: new Date(),
              },
            ]);
            onCodexInteractiveRequestSettled?.();
            break;
          }
          setPendingPermissionRequests((previous) =>
            setInteractiveRequestDeliveryState(
              previous,
              requestId,
              'failed',
              typeof latestMessage.error === 'string' && latestMessage.error.trim()
                ? latestMessage.error
                : 'Response was rejected. Please try again.',
            ),
          );
          break;
        }

      case 'codex-complete': {
        const codexPendingSessionId = sessionStorage.getItem('pendingSessionId');
        const codexActualSessionId = latestMessage.actualSessionId || codexPendingSessionId;
        const codexCompletedSessionId =
          latestMessage.sessionId || currentSessionId || codexPendingSessionId;

        finalizeLifecycleForCurrentView(
          codexCompletedSessionId,
          codexActualSessionId,
          currentSessionId,
          selectedSession?.id,
          codexPendingSessionId,
        );

        if (codexPendingSessionId && !currentSessionId) {
          setCurrentSessionId(codexActualSessionId);
          setIsSystemSessionChange(true);
          if (codexActualSessionId) {
            onNavigateToSession?.(codexActualSessionId);
          }
          sessionStorage.removeItem('pendingSessionId');
        }

        if (selectedProject) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        break;
      }

      case 'codex-error':
        finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: latestMessage.error || 'An error occurred with Codex',
            timestamp: new Date(),
          },
        ]);
        break;

      case 'gemini-response': {
        const geminiData = latestMessage.data;

        if (geminiData && geminiData.type === 'message' && typeof geminiData.content === 'string') {
          const content = decodeHtmlEntities(geminiData.content);

          if (content) {
            streamBufferRef.current += streamBufferRef.current ? `\n${content}` : content;
          }

          if (!geminiData.isPartial) {
            // Immediate flush and finalization for the last chunk
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';

            if (chunk) {
              appendStreamingChunk(setChatMessages, chunk, true);
            }
            finalizeStreamingMessage(setChatMessages);
          } else if (!streamTimerRef.current && streamBufferRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;

              if (chunk) {
                appendStreamingChunk(setChatMessages, chunk, true);
              }
            }, 100);
          }
        }
        break;
      }

      case 'gemini-error':
        finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: latestMessage.error || 'An error occurred with Gemini',
            timestamp: new Date(),
          },
        ]);
        break;

      case 'gemini-tool-use':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'assistant',
            content: '',
            timestamp: new Date(),
            isToolUse: true,
            toolName: latestMessage.toolName,
            toolInput: latestMessage.parameters ? JSON.stringify(latestMessage.parameters, null, 2) : '',
            toolId: latestMessage.toolId,
            toolResult: null,
          }
        ]);
        break;

      case 'gemini-tool-result':
        setChatMessages((previous) =>
          previous.map((message) => {
            if (message.isToolUse && message.toolId === latestMessage.toolId) {
              return {
                ...message,
                toolResult: {
                  content: latestMessage.output || `Status: ${latestMessage.status}`,
                  isError: latestMessage.status === 'error',
                  timestamp: new Date(),
                },
              };
            }
            return message;
          }),
        );
        break;

      case 'session-aborted': {
        const pendingSessionId =
          typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
        const abortedSessionId = latestMessage.sessionId || currentSessionId;
        const abortSucceeded = latestMessage.success !== false;

        if (abortSucceeded) {
          finalizeLifecycleForCurrentView(abortedSessionId, currentSessionId, selectedSession?.id, pendingSessionId);
          if (pendingSessionId && (!abortedSessionId || pendingSessionId === abortedSessionId)) {
            sessionStorage.removeItem('pendingSessionId');
          }

          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: 'Session interrupted by user.',
              timestamp: new Date(),
            },
          ]);
        } else {
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error',
              content: 'Stop request failed. The session is still running.',
              timestamp: new Date(),
            },
          ]);
        }
        break;
      }

      case 'session-status': {
        const statusSessionId = latestMessage.sessionId;
        if (!statusSessionId) {
          break;
        }

        const isCurrentSession =
          statusSessionId === currentSessionId || (selectedSession && statusSessionId === selectedSession.id);

        if (latestMessage.isProcessing) {
          onSessionProcessing?.(statusSessionId);
          if (isCurrentSession) {
            const pendingCodexRequest = provider === 'codex'
              ? pendingPermissionRequests.find((request) => request.sessionId === statusSessionId)
              : null;
            setIsLoading(true);
            setCanAbortSession(true);
            setClaudeStatus({
              text:
                pendingCodexRequest?.requestKind === 'user-input'
                  ? 'Waiting for input'
                  : pendingCodexRequest?.requestKind === 'terminal-stdin'
                    ? 'Waiting for terminal input'
                    : pendingCodexRequest
                      ? 'Waiting for permission'
                      : 'Processing',
              tokens: 0,
              can_interrupt: true,
            });
          }
          break;
        }

        onSessionInactive?.(statusSessionId);
        onSessionNotProcessing?.(statusSessionId);
        if (isCurrentSession) {
          clearLoadingIndicators();
        }
        break;
      }

      case 'claude-status': {
        const statusData = latestMessage.data;
        if (!statusData) {
          break;
        }

        const statusInfo: { text: string; tokens: number; can_interrupt: boolean } = {
          text: 'Working...',
          tokens: 0,
          can_interrupt: true,
        };

        if (statusData.message) {
          statusInfo.text = statusData.message;
        } else if (statusData.status) {
          statusInfo.text = statusData.status;
        } else if (typeof statusData === 'string') {
          statusInfo.text = statusData;
        }

        if (statusData.tokens) {
          statusInfo.tokens = statusData.tokens;
        } else if (statusData.token_count) {
          statusInfo.tokens = statusData.token_count;
        }

        if (statusData.can_interrupt !== undefined) {
          statusInfo.can_interrupt = statusData.can_interrupt;
        }

        setClaudeStatus(statusInfo);
        setIsLoading(true);
        setCanAbortSession(statusInfo.can_interrupt);
        break;
      }

      case 'pending-permissions-response': {
        // Server returned pending permissions for this session
        const permSessionId = latestMessage.sessionId;
        const permProvider = latestMessage.provider;
        const isCurrentPermSession =
          permSessionId === currentSessionId || (selectedSession && permSessionId === selectedSession.id);
        if (permSessionId && !isCurrentPermSession) {
          break;
        }
        if (permProvider && permProvider !== provider) {
          break;
        }
        const serverRequests = Array.isArray(latestMessage.data) ? latestMessage.data : [];
        setPendingPermissionRequests((previous) =>
          mergePendingInteractiveRequests(
            previous,
            serverRequests.map((request) => createPendingInteractiveRequest(request as PendingPermissionRequest)),
          ),
        );

        const firstRequest = serverRequests[0] || null;
        if (firstRequest?.provider === 'codex') {
          setIsLoading(serverRequests.length > 0);
          setCanAbortSession(serverRequests.length > 0);
          setClaudeStatus(serverRequests.length > 0
            ? {
                text:
                  firstRequest.requestKind === 'user-input'
                    ? 'Waiting for input'
                    : firstRequest.requestKind === 'terminal-stdin'
                      ? 'Waiting for terminal input'
                      : 'Waiting for permission',
                tokens: 0,
                can_interrupt: true,
              }
            : null);
        }
        break;
      }

      case 'error':
        // Generic backend failure (e.g., provider process failed before a provider-specific
        // completion event was emitted). Treat it as terminal for current view lifecycle.
        finalizeLifecycleForCurrentView(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        break;

      default:
        break;
    }
  }, [
    latestMessage,
    provider,
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
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    onNavigateToSession,
    onWebSocketReconnect,
    onCodexInteractiveRequestSettled,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
  ]);
}
