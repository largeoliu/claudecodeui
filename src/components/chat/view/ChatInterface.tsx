import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useLatestWebSocketMessage } from '../../../contexts/WebSocketContext';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type { ChatInterfaceProps, Provider } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import {
  getInteractiveRequestTimeoutMessage,
  getInteractiveRequestTimeoutMs,
  isInteractiveRequestInFlight,
  setInteractiveRequestDeliveryState,
} from '../utils/interactiveRequestTransport';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import CodexSessionControlsBar from './subcomponents/CodexSessionControlsBar';

const CHAT_REALTIME_MESSAGE_TYPES = new Set([
  'session-created',
  'websocket-reconnected',
  'token-budget',
  'claude-response',
  'claude-output',
  'claude-interactive-prompt',
  'claude-permission-request',
  'claude-permission-cancelled',
  'claude-error',
  'claude-complete',
  'codex-response',
  'codex-approval-request',
  'codex-user-input-request',
  'codex-command-stdin-request',
  'codex-request-cancelled',
  'codex-interactive-response-received',
  'codex-interactive-response-ack',
  'codex-interactive-response-error',
  'codex-complete',
  'codex-error',
  'gemini-response',
  'gemini-error',
  'gemini-tool-use',
  'gemini-tool-result',
  'session-aborted',
  'session-status',
  'claude-status',
  'pending-permissions-response',
  'error',
]);

type ChatRealtimeMessage = {
  type?: string;
  [key: string]: unknown;
};

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

type InFlightInteractiveRequestState = 'submitting' | 'processing';

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  onShowAllTasks,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { t } = useTranslation('chat');
  const latestMessage = useLatestWebSocketMessage<ChatRealtimeMessage>((message) =>
    CHAT_REALTIME_MESSAGE_TYPES.has(String(message.type || '')),
  );

  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);
  const interactiveRequestTimeoutsRef = useRef(
    new Map<string, { deliveryState: InFlightInteractiveRequestState; timeoutId: number }>(),
  );

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
  }, []);

  const {
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
    handleScroll,
    loadSessionMessages,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    autoScrollToBottom,
    externalMessageUpdate,
    processingSessions,
    resetStreamingState,
    pendingViewSessionRef,
  });

  const {
    provider,
    setProvider,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    codexInteractionMode,
    setCodexInteractionMode,
    codexApprovalPolicy,
    setCodexApprovalPolicy,
    codexReasoningEffort,
    setCodexReasoningEffort,
    handleCodexSessionCreated,
    geminiModel,
    setGeminiModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  } = useChatProviderState({
    selectedProject,
    selectedSession,
    currentSessionId,
  });

  const requestPendingPermissions = useCallback(() => {
    if (!selectedSession?.id) {
      return;
    }

    sendMessage({
      type: 'get-pending-permissions',
      sessionId: selectedSession.id,
      provider: selectedSession.__provider || provider,
    });
  }, [provider, selectedSession, sendMessage]);

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleTranscript,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider,
    permissionMode,
    codexInteractionMode,
    codexApprovalPolicy,
    cyclePermissionMode,
    claudeModel,
    codexModel,
    codexReasoningEffort,
    geminiModel,
    isLoading,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionActive,
    onSessionProcessing,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    pendingViewSessionRef,
    scrollToBottom,
    setChatMessages,
    setSessionMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setIsUserScrolledUp,
    pendingPermissionRequests,
    setPendingPermissionRequests,
  });

  // On WebSocket reconnect, re-fetch the current session's messages from JSONL so missed
  // streaming events (e.g. from long tool calls while iOS had the tab backgrounded) are shown.
  // Also reset isLoading — if the server restarted or the session died mid-stream, the client
  // would be stuck in "Processing..." forever without this reset.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    const provider = selectedSession.__provider || (localStorage.getItem('selected-provider') as any) || 'claude';
    const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false, provider);
    if (messages && messages.length > 0) {
      setChatMessages(messages);
    }
    // Reset loading state — if the session is still active, new WebSocket messages will
    // set it back to true. If it died, this clears the permanent frozen state.
    setIsLoading(false);
    setCanAbortSession(false);
    requestPendingPermissions();
  }, [
    selectedProject,
    selectedSession,
    loadSessionMessages,
    setChatMessages,
    setIsLoading,
    setCanAbortSession,
    requestPendingPermissions,
  ]);

  useChatRealtimeHandlers({
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
    onCodexSessionCreated: handleCodexSessionCreated,
    onNavigateToSession,
    onWebSocketReconnect: handleWebSocketReconnect,
  });

  useEffect(() => {
    if (!ws || !selectedSession?.id) {
      return;
    }

    requestPendingPermissions();
  }, [requestPendingPermissions, selectedSession?.id, ws]);

  useEffect(() => {
    const nextInFlightStates = new Map<string, InFlightInteractiveRequestState>();

    pendingPermissionRequests.forEach((request) => {
      if (request.provider !== 'codex' || !isInteractiveRequestInFlight(request.deliveryState)) {
        return;
      }

      nextInFlightStates.set(request.requestId, request.deliveryState);
    });

    interactiveRequestTimeoutsRef.current.forEach((entry, requestId) => {
      const nextState = nextInFlightStates.get(requestId);
      if (!nextState || nextState !== entry.deliveryState) {
        clearTimeout(entry.timeoutId);
        interactiveRequestTimeoutsRef.current.delete(requestId);
      }
    });

    nextInFlightStates.forEach((deliveryState, requestId) => {
      if (interactiveRequestTimeoutsRef.current.has(requestId)) {
        return;
      }

      const timeoutMs = getInteractiveRequestTimeoutMs(deliveryState);
      if (timeoutMs === null) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        interactiveRequestTimeoutsRef.current.delete(requestId);
        requestPendingPermissions();
        setPendingPermissionRequests((previous) => {
          const request = previous.find((item) => item.requestId === requestId);
          if (
            !request
            || request.provider !== 'codex'
            || request.deliveryState !== deliveryState
          ) {
            return previous;
          }

          return setInteractiveRequestDeliveryState(
            previous,
            requestId,
            'failed',
            getInteractiveRequestTimeoutMessage(deliveryState),
          );
        });
      }, timeoutMs);

      interactiveRequestTimeoutsRef.current.set(requestId, { deliveryState, timeoutId });
    });
  }, [pendingPermissionRequests, requestPendingPermissions, setPendingPermissionRequests]);

  useEffect(() => () => {
    interactiveRequestTimeoutsRef.current.forEach(({ timeoutId }) => {
      clearTimeout(timeoutId);
    });
    interactiveRequestTimeoutsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  if (!selectedProject) {
    const selectedProviderLabel =
      provider === 'codex'
        ? t('messageTypes.codex')
        : provider === 'gemini'
          ? t('messageTypes.gemini')
          : t('messageTypes.claude');

    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col">

        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={isLoadingSessionMessages}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
          textareaRef={textareaRef}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          geminiModel={geminiModel}
          setGeminiModel={setGeminiModel}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          sessionMessagesCount={sessionMessages.length}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          isSearchScrollActive={isSearchScrollActive}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          isLoading={isLoading}
        />

        <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          claudeStatus={claudeStatus}
          isLoading={isLoading}
          canAbortSession={canAbortSession}
          onAbortSession={handleAbortSession}
          provider={provider}
          permissionMode={permissionMode}
          onModeSwitch={cyclePermissionMode}
          codexInteractionMode={codexInteractionMode}
          setCodexInteractionMode={setCodexInteractionMode}
          codexApprovalPolicy={codexApprovalPolicy}
          setCodexApprovalPolicy={setCodexApprovalPolicy}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          thinkingMode={thinkingMode}
          setThinkingMode={setThinkingMode}
          codexReasoningEffort={codexReasoningEffort}
          setCodexReasoningEffort={setCodexReasoningEffort}
          tokenBudget={tokenBudget}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          isUserScrolledUp={isUserScrolledUp}
          hasMessages={chatMessages.length > 0}
          onScrollToBottom={scrollToBottomAndReset}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          attachedImages={attachedImages}
          onRemoveImage={(index) =>
            setAttachedImages((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingImages={uploadingImages}
          imageErrors={imageErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openImagePicker={openImagePicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          isInputFocused={isInputFocused}
          placeholder={t('input.placeholder', {
            provider:
              provider === 'codex'
                ? t('messageTypes.codex')
                : provider === 'gemini'
                  ? t('messageTypes.gemini')
                  : t('messageTypes.claude'),
          })}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
          onTranscript={handleTranscript}
        />
      </div>

      <QuickSettingsPanel />
    </>
  );
}

export default React.memo(ChatInterface);
