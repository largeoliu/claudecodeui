import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { api, authenticatedFetch } from '../../../utils/api';
import type { ChatMessage, Provider } from '../types/types';
import type { Project, ProjectSession } from '../../../types/app';
import { getChatMessagesStorageKey, safeLocalStorage } from '../utils/chatStorage';
import {
  convertSessionMessages,
  createCachedDiffCalculator,
  type DiffCalculator,
} from '../utils/messageTransforms';

const MESSAGES_PER_PAGE = 20;
const INITIAL_VISIBLE_MESSAGES = 100;

function getSessionRequestKey(projectName: string, sessionId: string, provider: Provider | string = 'claude') {
  return `${projectName}:${provider}:${sessionId}`;
}

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => boolean;
  autoScrollToBottom?: boolean;
  externalMessageUpdate?: number;
  processingSessions?: Set<string>;
  resetStreamingState: () => void;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
}

interface ScrollRestoreState {
  height: number;
  top: number;
}

export function useChatSessionState({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  autoScrollToBottom,
  externalMessageUpdate,
  processingSessions,
  resetStreamingState,
  pendingViewSessionRef,
}: UseChatSessionStateArgs) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    if (
      typeof window !== 'undefined'
      && selectedProject
      && selectedSession?.id
      && !selectedSession.id.startsWith('new-session-')
    ) {
      const storageKey = getChatMessagesStorageKey(
        selectedProject.name,
        selectedSession.id,
        selectedSession.__provider || 'claude',
      );
      const saved = safeLocalStorage.getItem(storageKey);
      if (saved) {
        try {
          return JSON.parse(saved) as ChatMessage[];
        } catch {
          console.error('Failed to parse saved chat messages, resetting');
          safeLocalStorage.removeItem(storageKey);
          return [];
        }
      }
      return [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [claudeStatus, setClaudeStatus] = useState<{ text: string; tokens: number; can_interrupt: boolean } | null>(null);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);
  const [isSearchScrollActive, setIsSearchScrollActive] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [searchTarget, setSearchTarget] = useState<{ timestamp?: string; uuid?: string; snippet?: string } | null>(null);
  const searchScrollActiveRef = useRef(false);
  const isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const allMessagesLoadedRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const hasInitializedSelectionRef = useRef(false);
  const messagesOffsetRef = useRef(0);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSyncedSessionMessagesRef = useRef<any[] | null>(sessionMessages);
  const latestInitialLoadTokenRef = useRef(0);
  const latestMoreLoadTokenRef = useRef(0);

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);
  const activeSessionRequestKey = useMemo(() => {
    if (!selectedProject?.name || !selectedSession?.id) {
      return null;
    }

    return getSessionRequestKey(
      selectedProject.name,
      selectedSession.id,
      selectedSession.__provider || 'claude',
    );
  }, [selectedProject?.name, selectedSession?.id, selectedSession?.__provider]);
  const activeSessionRequestKeyRef = useRef<string | null>(activeSessionRequestKey);
  const currentChatMessagesStorageKey = useMemo(() => {
    if (typeof window === 'undefined' || !selectedProject?.name) {
      return null;
    }

    const sessionIdForStorage = selectedSession?.id || currentSessionId;
    if (!sessionIdForStorage || sessionIdForStorage.startsWith('new-session-')) {
      return null;
    }

    const sessionProvider = selectedSession?.__provider
      || (localStorage.getItem('selected-provider') as Provider)
      || 'claude';

    return getChatMessagesStorageKey(selectedProject.name, sessionIdForStorage, sessionProvider);
  }, [currentSessionId, selectedProject?.name, selectedSession?.id, selectedSession?.__provider]);

  useEffect(() => {
    activeSessionRequestKeyRef.current = activeSessionRequestKey;
  }, [activeSessionRequestKey]);

  const isCurrentSessionRequest = useCallback(
    (requestKey: string | null) => requestKey !== null && activeSessionRequestKeyRef.current === requestKey,
    [],
  );

  const loadSessionMessages = useCallback(
    async (projectName: string, sessionId: string, loadMore = false, provider: Provider | string = 'claude') => {
      if (!projectName || !sessionId) {
        return [] as any[];
      }

      const isInitialLoad = !loadMore;
      if (isInitialLoad) {
        setIsLoadingSessionMessages(true);
      } else {
        setIsLoadingMoreMessages(true);
      }
      const requestToken = isInitialLoad
        ? ++latestInitialLoadTokenRef.current
        : ++latestMoreLoadTokenRef.current;

      try {
        const currentOffset = loadMore ? messagesOffsetRef.current : 0;
        const response = await (api.sessionMessages as any)(
          projectName,
          sessionId,
          MESSAGES_PER_PAGE,
          currentOffset,
          provider,
        );
        if (!response.ok) {
          throw new Error('Failed to load session messages');
        }

        const data = await response.json();
        if (isInitialLoad && data.tokenUsage) {
          setTokenBudget(data.tokenUsage);
        }

        if (data.hasMore !== undefined) {
          const loadedCount = data.messages?.length || 0;
          setHasMoreMessages(Boolean(data.hasMore));
          setTotalMessages(Number(data.total || 0));
          messagesOffsetRef.current = currentOffset + loadedCount;
          return data.messages || [];
        }

        const messages = data.messages || [];
        setHasMoreMessages(false);
        setTotalMessages(messages.length);
        messagesOffsetRef.current = messages.length;
        return messages;
      } catch (error) {
        console.error('Error loading session messages:', error);
        return [];
      } finally {
        if (isInitialLoad) {
          if (latestInitialLoadTokenRef.current === requestToken) {
            setIsLoadingSessionMessages(false);
          }
        } else {
          if (latestMoreLoadTokenRef.current === requestToken) {
            setIsLoadingMoreMessages(false);
          }
        }
      }
    },
    [],
  );

  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, []);

  const scrollToBottomAndReset = useCallback(() => {
    scrollToBottom();
    if (allMessagesLoaded) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
      allMessagesLoadedRef.current = false;
    }
  }, [allMessagesLoaded, scrollToBottom]);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return false;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const loadOlderMessages = useCallback(
    async (container: HTMLDivElement) => {
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) {
        return false;
      }
      if (allMessagesLoadedRef.current) return false;
      if (!hasMoreMessages || !selectedSession || !selectedProject) {
        return false;
      }

      const sessionProvider = selectedSession.__provider || 'claude';
      const requestSessionKey = getSessionRequestKey(
        selectedProject.name,
        selectedSession.id,
        sessionProvider,
      );

      isLoadingMoreRef.current = true;
      const previousScrollHeight = container.scrollHeight;
      const previousScrollTop = container.scrollTop;

      try {
        const moreMessages = await loadSessionMessages(
          selectedProject.name,
          selectedSession.id,
          true,
          sessionProvider,
        );

        if (!isCurrentSessionRequest(requestSessionKey) || moreMessages.length === 0) {
          return false;
        }

        pendingScrollRestoreRef.current = {
          height: previousScrollHeight,
          top: previousScrollTop,
        };
        setSessionMessages((previous) => [...moreMessages, ...previous]);
        // Keep the rendered window in sync with top-pagination so newly loaded history becomes visible.
        setVisibleMessageCount((previousCount) => previousCount + moreMessages.length);
        return true;
      } finally {
        isLoadingMoreRef.current = false;
      }
    },
    [hasMoreMessages, isCurrentSessionRequest, isLoadingMoreMessages, loadSessionMessages, selectedProject, selectedSession],
  );

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const nearBottom = isNearBottom();
    setIsUserScrolledUp(!nearBottom);

    if (!allMessagesLoadedRef.current) {
      const scrolledNearTop = container.scrollTop < 100;
      if (!scrolledNearTop) {
        topLoadLockRef.current = false;
        return;
      }

      if (topLoadLockRef.current) {
        if (container.scrollTop > 20) {
          topLoadLockRef.current = false;
        }
        return;
      }

      const didLoad = await loadOlderMessages(container);
      if (didLoad) {
        topLoadLockRef.current = true;
      }
    }
  }, [isNearBottom, loadOlderMessages]);

  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) {
      return;
    }

    const { height, top } = pendingScrollRestoreRef.current;
    const container = scrollContainerRef.current;
    const newScrollHeight = container.scrollHeight;
    const scrollDiff = newScrollHeight - height;
    container.scrollTop = top + Math.max(scrollDiff, 0);
    pendingScrollRestoreRef.current = null;
  }, [chatMessages.length]);

  useEffect(() => {
    if (!hasInitializedSelectionRef.current) {
      hasInitializedSelectionRef.current = true;
      return;
    }

    if (!searchScrollActiveRef.current) {
      pendingInitialScrollRef.current = true;
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    }
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    latestSyncedSessionMessagesRef.current = null;
    setIsUserScrolledUp(false);
  }, [selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) {
      return;
    }

    if (chatMessages.length === 0) {
      pendingInitialScrollRef.current = false;
      return;
    }

    pendingInitialScrollRef.current = false;
    if (!searchScrollActiveRef.current) {
      setTimeout(() => {
        scrollToBottom();
      }, 200);
    }
  }, [chatMessages.length, isLoadingSessionMessages, scrollToBottom]);

  useEffect(() => {
    const loadMessages = async () => {
      try {
        if (selectedSession && selectedProject) {
          const sessionProvider = selectedSession.__provider || 'claude';
          const requestSessionKey = getSessionRequestKey(
            selectedProject.name,
            selectedSession.id,
            sessionProvider,
          );

          isLoadingSessionRef.current = true;

          const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;
          if (sessionChanged) {
            if (!isSystemSessionChange) {
              resetStreamingState();
              pendingViewSessionRef.current = null;
              setChatMessages([]);
              setSessionMessages([]);
              setClaudeStatus(null);
              setCanAbortSession(false);
            }

            messagesOffsetRef.current = 0;
            setHasMoreMessages(false);
            setTotalMessages(0);
            setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
            setAllMessagesLoaded(false);
            allMessagesLoadedRef.current = false;
            setIsLoadingAllMessages(false);
            setLoadAllJustFinished(false);
            setShowLoadAllOverlay(false);
            if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
            if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
            setTokenBudget(null);
            setIsLoading(false);

            if (ws) {
              sendMessage({
                type: 'check-session-status',
                sessionId: selectedSession.id,
                provider: sessionProvider,
              });
            }
          } else if (currentSessionId === null) {
            messagesOffsetRef.current = 0;
            setHasMoreMessages(false);
            setTotalMessages(0);

            if (ws) {
              sendMessage({
                type: 'check-session-status',
                sessionId: selectedSession.id,
                provider: sessionProvider,
              });
            }
          }

          setCurrentSessionId(selectedSession.id);

          if (!isSystemSessionChange) {
            const messages = await loadSessionMessages(
              selectedProject.name,
              selectedSession.id,
              false,
              sessionProvider,
            );

            if (!isCurrentSessionRequest(requestSessionKey)) {
              return;
            }

            setSessionMessages(messages);
          } else {
            setIsSystemSessionChange(false);
          }
        } else {
          if (!isSystemSessionChange) {
            resetStreamingState();
            pendingViewSessionRef.current = null;
            setChatMessages([]);
            setSessionMessages([]);
            setClaudeStatus(null);
            setCanAbortSession(false);
            setIsLoading(false);
          }

          setCurrentSessionId(null);
          messagesOffsetRef.current = 0;
          setHasMoreMessages(false);
          setTotalMessages(0);
          setTokenBudget(null);
        }
      } finally {
        setTimeout(() => {
          isLoadingSessionRef.current = false;
        }, 250);
      }
    };

    loadMessages();
    // Intentionally exclude currentSessionId: this effect sets it and should not retrigger another full load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isCurrentSessionRequest,
    isSystemSessionChange,
    loadSessionMessages,
    pendingViewSessionRef,
    resetStreamingState,
    selectedProject?.name,
    selectedSession?.id,
    selectedSession?.__provider,
    sendMessage,
    ws,
  ]);

  useEffect(() => {
    if (!externalMessageUpdate || !selectedSession || !selectedProject) {
      return;
    }

    const reloadExternalMessages = async () => {
      try {
        const sessionProvider = selectedSession.__provider || 'claude';
        const requestSessionKey = getSessionRequestKey(
          selectedProject.name,
          selectedSession.id,
          sessionProvider,
        );

        const messages = await loadSessionMessages(
          selectedProject.name,
          selectedSession.id,
          false,
          sessionProvider,
        );
        if (!isCurrentSessionRequest(requestSessionKey)) {
          return;
        }
        setSessionMessages(messages);

        const shouldAutoScroll = Boolean(autoScrollToBottom) && isNearBottom();
        if (shouldAutoScroll) {
          setTimeout(() => scrollToBottom(), 200);
        }
      } catch (error) {
        console.error('Error reloading messages from external update:', error);
      }
    };

    reloadExternalMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoScrollToBottom,
    externalMessageUpdate,
    isCurrentSessionRequest,
    isNearBottom,
    loadSessionMessages,
    scrollToBottom,
    selectedProject?.name,
    selectedSession?.id,
    selectedSession?.__provider,
  ]);

  // Detect search navigation target from selectedSession object reference change
  // This must be a separate effect because the loading effect depends on selectedSession?.id
  // which doesn't change when clicking a search result for the already-loaded session
  useEffect(() => {
    const session = selectedSession as Record<string, unknown> | null;
    const targetSnippet = session?.__searchTargetSnippet;
    const targetTimestamp = session?.__searchTargetTimestamp;
    if (typeof targetSnippet === 'string' && targetSnippet) {
      searchScrollActiveRef.current = true;
      setIsSearchScrollActive(true);
      setSearchTarget({
        snippet: targetSnippet,
        timestamp: typeof targetTimestamp === 'string' ? targetTimestamp : undefined,
      });
    }
  }, [selectedSession]);

  useEffect(() => {
    if (selectedSession?.id) {
      pendingViewSessionRef.current = null;
    }
  }, [pendingViewSessionRef, selectedSession?.id]);

  useEffect(() => {
    if (isLoading || sessionMessages === latestSyncedSessionMessagesRef.current) {
      return;
    }

    setChatMessages(convertedMessages);
    latestSyncedSessionMessagesRef.current = sessionMessages;
  }, [convertedMessages, isLoading, sessionMessages, setChatMessages]);

  useEffect(() => {
    if (!currentChatMessagesStorageKey) {
      return;
    }

    if (chatMessages.length > 0) {
      safeLocalStorage.setItem(currentChatMessagesStorageKey, JSON.stringify(chatMessages));
      return;
    }

    safeLocalStorage.removeItem(currentChatMessagesStorageKey);
  }, [chatMessages, currentChatMessagesStorageKey]);

  // Scroll to search target message after messages are loaded
  useEffect(() => {
    if (!searchTarget || chatMessages.length === 0 || isLoadingSessionMessages) return;

    const target = searchTarget;
    // Clear immediately to prevent re-triggering
    setSearchTarget(null);

    const scrollToTarget = async () => {
      const requestSessionKey = selectedSession && selectedProject
        ? getSessionRequestKey(
            selectedProject.name,
            selectedSession.id,
            selectedSession.__provider || 'claude',
          )
        : null;

      // Always load all messages when navigating from search
      // (hasMoreMessages may not be set yet due to race with loading effect)
      if (!allMessagesLoadedRef.current && requestSessionKey && selectedSession && selectedProject) {
        const sessionProvider = selectedSession.__provider || 'claude';
        try {
          const response = await (api.sessionMessages as any)(
            selectedProject.name,
            selectedSession.id,
            null,
            0,
            sessionProvider,
          );
          if (response.ok && isCurrentSessionRequest(requestSessionKey)) {
            const data = await response.json();
            const allMessages = data.messages || data;
            setSessionMessages(Array.isArray(allMessages) ? allMessages : []);
            setHasMoreMessages(false);
            setTotalMessages(Array.isArray(allMessages) ? allMessages.length : 0);
            messagesOffsetRef.current = Array.isArray(allMessages) ? allMessages.length : 0;
            setVisibleMessageCount(Infinity);
            setAllMessagesLoaded(true);
            allMessagesLoadedRef.current = true;
            // Wait for messages to render after state update
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } catch {
          // Fall through and scroll in current messages
        }
      }

      if (requestSessionKey && !isCurrentSessionRequest(requestSessionKey)) {
        return;
      }

      setVisibleMessageCount(Infinity);

      // Retry finding the element in the DOM until React finishes rendering all messages
      const findAndScroll = (retriesLeft: number) => {
        const container = scrollContainerRef.current;
        if (!container) return;

        let targetElement: Element | null = null;

        // Match by snippet text content (most reliable)
        if (target.snippet) {
          const cleanSnippet = target.snippet.replace(/^\.{3}/, '').replace(/\.{3}$/, '').trim();
          // Use a contiguous substring from the snippet (don't filter words, it breaks matching)
          const searchPhrase = cleanSnippet.slice(0, 80).toLowerCase().trim();

          if (searchPhrase.length >= 10) {
            const messageElements = container.querySelectorAll('.chat-message');
            for (const el of messageElements) {
              const text = (el.textContent || '').toLowerCase();
              if (text.includes(searchPhrase)) {
                targetElement = el;
                break;
              }
            }
          }
        }

        // Fallback to timestamp matching
        if (!targetElement && target.timestamp) {
          const targetDate = new Date(target.timestamp).getTime();
          const messageElements = container.querySelectorAll('[data-message-timestamp]');
          let closestDiff = Infinity;

          for (const el of messageElements) {
            const ts = el.getAttribute('data-message-timestamp');
            if (!ts) continue;
            const diff = Math.abs(new Date(ts).getTime() - targetDate);
            if (diff < closestDiff) {
              closestDiff = diff;
              targetElement = el;
            }
          }
        }

        if (targetElement) {
          targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
          targetElement.classList.add('search-highlight-flash');
          setTimeout(() => targetElement?.classList.remove('search-highlight-flash'), 4000);
          searchScrollActiveRef.current = false;
          setIsSearchScrollActive(false);
        } else if (retriesLeft > 0) {
          setTimeout(() => findAndScroll(retriesLeft - 1), 200);
        } else {
          searchScrollActiveRef.current = false;
          setIsSearchScrollActive(false);
        }
      };

      // Start polling after a short delay to let React begin rendering
      setTimeout(() => findAndScroll(15), 150);
    };

    scrollToTarget();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, isLoadingSessionMessages, searchTarget]);

  useEffect(() => {
    if (!selectedProject || !selectedSession?.id || selectedSession.id.startsWith('new-session-')) {
      setTokenBudget(null);
      return;
    }

    const sessionProvider = selectedSession.__provider || 'claude';
    if (sessionProvider !== 'claude') {
      return;
    }

    const fetchInitialTokenUsage = async () => {
      try {
        const url = `/api/projects/${selectedProject.name}/sessions/${selectedSession.id}/token-usage`;
        const response = await authenticatedFetch(url);
        if (response.ok) {
          const data = await response.json();
          setTokenBudget(data);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };

    fetchInitialTokenUsage();
  }, [selectedProject, selectedSession?.id, selectedSession?.__provider]);

  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) {
      return chatMessages;
    }
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  useEffect(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop,
      };
    }
  });

  useEffect(() => {
    if (!scrollContainerRef.current || chatMessages.length === 0) {
      return;
    }

    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) {
      return;
    }

    if (searchScrollActiveRef.current) {
      return;
    }

    if (autoScrollToBottom) {
      if (!isUserScrolledUp) {
        setTimeout(() => scrollToBottom(), 50);
      }
      return;
    }

    const container = scrollContainerRef.current;
    const prevHeight = scrollPositionRef.current.height;
    const prevTop = scrollPositionRef.current.top;
    const newHeight = container.scrollHeight;
    const heightDiff = newHeight - prevHeight;

    if (heightDiff > 0 && prevTop > 0) {
      container.scrollTop = prevTop + heightDiff;
    }
  }, [autoScrollToBottom, chatMessages.length, isLoadingMoreMessages, isUserScrolledUp, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const activeViewSessionId = selectedSession?.id || currentSessionId;
    if (!activeViewSessionId || !processingSessions) {
      return;
    }

    const shouldBeProcessing = processingSessions.has(activeViewSessionId);
    if (shouldBeProcessing && !isLoading) {
      setIsLoading(true);
      setCanAbortSession(true);
    }
  }, [currentSessionId, isLoading, processingSessions, selectedSession?.id]);

  // Show "Load all" overlay after a batch finishes loading, persist for 2s then hide
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoadingMoreMessages;

    if (wasLoading && !isLoadingMoreMessages && hasMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(true);
      loadAllOverlayTimerRef.current = setTimeout(() => {
        setShowLoadAllOverlay(false);
      }, 2000);
    }
    if (!hasMoreMessages && !isLoadingMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(false);
    }
    return () => {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    };
  }, [isLoadingMoreMessages, hasMoreMessages]);

  const loadAllMessages = useCallback(async () => {
    if (!selectedSession || !selectedProject) return;
    if (isLoadingAllMessages) return;
    const sessionProvider = selectedSession.__provider || 'claude';

    const requestSessionId = selectedSession.id;
    const requestSessionKey = getSessionRequestKey(
      selectedProject.name,
      requestSessionId,
      sessionProvider,
    );

    allMessagesLoadedRef.current = true;
    isLoadingMoreRef.current = true;
    setIsLoadingAllMessages(true);
    setShowLoadAllOverlay(true);

    const container = scrollContainerRef.current;
    const previousScrollHeight = container ? container.scrollHeight : 0;
    const previousScrollTop = container ? container.scrollTop : 0;

    try {
      const response = await (api.sessionMessages as any)(
        selectedProject.name,
        requestSessionId,
        null,
        0,
        sessionProvider,
      );

      if (!isCurrentSessionRequest(requestSessionKey)) return;

      if (response.ok) {
        const data = await response.json();
        const allMessages = data.messages || data;

        if (container) {
          pendingScrollRestoreRef.current = {
            height: previousScrollHeight,
            top: previousScrollTop,
          };
        }

        setSessionMessages(Array.isArray(allMessages) ? allMessages : []);
        setHasMoreMessages(false);
        setTotalMessages(Array.isArray(allMessages) ? allMessages.length : 0);
        messagesOffsetRef.current = Array.isArray(allMessages) ? allMessages.length : 0;

        setVisibleMessageCount(Infinity);
        setAllMessagesLoaded(true);

        setLoadAllJustFinished(true);
        if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
        loadAllFinishedTimerRef.current = setTimeout(() => {
          setLoadAllJustFinished(false);
          setShowLoadAllOverlay(false);
        }, 1000);
      } else {
        allMessagesLoadedRef.current = false;
        setShowLoadAllOverlay(false);
      }
    } catch (error) {
      console.error('Error loading all messages:', error);
      allMessagesLoadedRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingAllMessages(false);
    }
  }, [isCurrentSessionRequest, isLoadingAllMessages, selectedProject, selectedSession]);

  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount((previousCount) => previousCount + 100);
  }, []);

  return {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isSystemSessionChange,
    setIsSystemSessionChange,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    isSearchScrollActive,
    claudeStatus,
    setClaudeStatus,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    isNearBottom,
    handleScroll,
    loadSessionMessages,
  };
}
