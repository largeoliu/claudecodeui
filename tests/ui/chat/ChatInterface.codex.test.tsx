// @vitest-environment jsdom

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { vi } from 'vitest';

const chatInterfaceMocks = vi.hoisted(() => {
  const sessionState = {
    chatMessages: [] as any[],
    setChatMessages: vi.fn((value: any) => {
      sessionState.chatMessages = typeof value === 'function' ? value(sessionState.chatMessages) : value;
    }),
    isLoading: false,
    setIsLoading: vi.fn((value: boolean) => {
      sessionState.isLoading = value;
    }),
    currentSessionId: 'codex-session-1',
    setCurrentSessionId: vi.fn((value: string | null) => {
      sessionState.currentSessionId = value;
    }),
    sessionMessages: [] as any[],
    setSessionMessages: vi.fn((value: any) => {
      sessionState.sessionMessages = typeof value === 'function' ? value(sessionState.sessionMessages) : value;
    }),
    isLoadingSessionMessages: false,
    isLoadingMoreMessages: false,
    hasMoreMessages: false,
    totalMessages: 0,
    setIsSystemSessionChange: vi.fn(),
    canAbortSession: false,
    setCanAbortSession: vi.fn((value: boolean) => {
      sessionState.canAbortSession = value;
    }),
    isUserScrolledUp: false,
    setIsUserScrolledUp: vi.fn(),
    tokenBudget: null as Record<string, unknown> | null,
    setTokenBudget: vi.fn((value: Record<string, unknown> | null) => {
      sessionState.tokenBudget = value;
    }),
    visibleMessageCount: 0,
    visibleMessages: [] as any[],
    loadEarlierMessages: vi.fn(),
    loadAllMessages: vi.fn(),
    allMessagesLoaded: true,
    isLoadingAllMessages: false,
    loadAllJustFinished: false,
    showLoadAllOverlay: false,
    isSearchScrollActive: false,
    claudeStatus: null as { text: string; tokens: number; can_interrupt: boolean } | null,
    setClaudeStatus: vi.fn((value: { text: string; tokens: number; can_interrupt: boolean } | null) => {
      sessionState.claudeStatus = value;
    }),
    createDiff: vi.fn(),
    scrollContainerRef: { current: null },
    scrollToBottom: vi.fn(),
    scrollToBottomAndReset: vi.fn(),
    handleScroll: vi.fn(),
    loadSessionMessages: vi.fn(),
  };

  const providerState = {
    provider: 'codex',
    setProvider: vi.fn((value: string) => {
      providerState.provider = value;
    }),
    claudeModel: 'claude-sonnet-4',
    setClaudeModel: vi.fn(),
    codexModel: 'gpt-5-codex',
    setCodexModel: vi.fn(),
    codexInteractionMode: 'edit',
    setCodexInteractionMode: vi.fn(),
    codexApprovalPolicy: 'on-request',
    setCodexApprovalPolicy: vi.fn(),
    codexReasoningEffort: 'medium',
    setCodexReasoningEffort: vi.fn(),
    handleCodexSessionCreated: vi.fn(),
    geminiModel: 'gemini-2.5-pro',
    setGeminiModel: vi.fn(),
    permissionMode: 'default',
    pendingPermissionRequests: [] as any[],
    setPendingPermissionRequests: vi.fn((value: any) => {
      providerState.pendingPermissionRequests =
        typeof value === 'function' ? value(providerState.pendingPermissionRequests) : value;
    }),
    cyclePermissionMode: vi.fn(),
  };

  const composerState = {
    input: '',
    setInput: vi.fn((value: string) => {
      composerState.input = value;
    }),
    textareaRef: { current: null },
    inputHighlightRef: { current: null },
    isTextareaExpanded: false,
    thinkingMode: 'none',
    setThinkingMode: vi.fn(),
    slashCommandsCount: 0,
    filteredCommands: [] as any[],
    frequentCommands: [] as any[],
    commandQuery: '',
    showCommandMenu: false,
    selectedCommandIndex: 0,
    resetCommandMenuState: vi.fn(),
    handleCommandSelect: vi.fn(),
    handleToggleCommandMenu: vi.fn(),
    showFileDropdown: false,
    filteredFiles: [] as any[],
    selectedFileIndex: 0,
    renderInputWithMentions: (value: string) => value,
    selectFile: vi.fn(),
    attachedImages: [] as any[],
    setAttachedImages: vi.fn((value: any) => {
      composerState.attachedImages = typeof value === 'function' ? value(composerState.attachedImages) : value;
    }),
    uploadingImages: new Map(),
    imageErrors: new Map(),
    getRootProps: vi.fn(() => ({})),
    getInputProps: vi.fn(() => ({})),
    isDragActive: false,
    openImagePicker: vi.fn(),
    handleSubmit: vi.fn(),
    handleInputChange: vi.fn(),
    handleKeyDown: vi.fn(),
    handlePaste: vi.fn(),
    handleTextareaClick: vi.fn(),
    handleTextareaInput: vi.fn(),
    syncInputOverlayScroll: vi.fn(),
    handleClearInput: vi.fn(),
    handleAbortSession: vi.fn(),
    handleTranscript: vi.fn(),
    handlePermissionDecision: vi.fn(),
    handleGrantToolPermission: vi.fn(),
    handleInputFocusChange: vi.fn(),
    isInputFocused: false,
  };

  return {
    sessionState,
    providerState,
    composerState,
    latestMessage: null as any,
    realtimeArgs: null as any,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; provider?: string }) => options?.defaultValue ?? options?.provider ?? key,
  }),
}));

vi.mock('../../../src/contexts/TasksSettingsContext', () => ({
  useTasksSettings: () => ({
    tasksEnabled: false,
    isTaskMasterInstalled: false,
  }),
}));

vi.mock('../../../src/contexts/WebSocketContext', () => ({
  useLatestWebSocketMessage: () => chatInterfaceMocks.latestMessage,
}));

vi.mock('../../../src/components/quick-settings-panel', () => ({
  QuickSettingsPanel: () => null,
}));

vi.mock('../../../src/components/chat/hooks/useChatSessionState', () => ({
  useChatSessionState: () => chatInterfaceMocks.sessionState,
}));

vi.mock('../../../src/components/chat/hooks/useChatProviderState', () => ({
  useChatProviderState: () => chatInterfaceMocks.providerState,
}));

vi.mock('../../../src/components/chat/hooks/useChatComposerState', () => ({
  useChatComposerState: () => chatInterfaceMocks.composerState,
}));

vi.mock('../../../src/components/chat/hooks/useChatRealtimeHandlers', () => ({
  useChatRealtimeHandlers: (args: unknown) => {
    chatInterfaceMocks.realtimeArgs = args;
  },
}));

vi.mock('../../../src/components/chat/view/subcomponents/ChatMessagesPane', () => ({
  default: () => null,
}));

vi.mock('../../../src/components/chat/view/subcomponents/ChatComposer', () => ({
  default: () => null,
}));

vi.mock('../../../src/components/chat/view/subcomponents/CodexSessionControlsBar', () => ({
  default: () => null,
}));

import ChatInterface from '../../../src/components/chat/view/ChatInterface';

const selectedProject = {
  name: 'demo-project',
  displayName: 'Demo Project',
  fullPath: '/work/demo-project',
} as any;

const selectedSession = {
  id: 'codex-session-1',
  __provider: 'codex',
} as any;

function resetChatInterfaceMocks() {
  chatInterfaceMocks.latestMessage = null;
  chatInterfaceMocks.realtimeArgs = null;

  chatInterfaceMocks.sessionState.chatMessages = [];
  chatInterfaceMocks.sessionState.setChatMessages.mockClear();
  chatInterfaceMocks.sessionState.isLoading = false;
  chatInterfaceMocks.sessionState.setIsLoading.mockClear();
  chatInterfaceMocks.sessionState.currentSessionId = 'codex-session-1';
  chatInterfaceMocks.sessionState.setCurrentSessionId.mockClear();
  chatInterfaceMocks.sessionState.sessionMessages = [];
  chatInterfaceMocks.sessionState.setSessionMessages.mockClear();
  chatInterfaceMocks.sessionState.setIsSystemSessionChange.mockClear();
  chatInterfaceMocks.sessionState.canAbortSession = false;
  chatInterfaceMocks.sessionState.setCanAbortSession.mockClear();
  chatInterfaceMocks.sessionState.setIsUserScrolledUp.mockClear();
  chatInterfaceMocks.sessionState.tokenBudget = null;
  chatInterfaceMocks.sessionState.setTokenBudget.mockClear();
  chatInterfaceMocks.sessionState.setClaudeStatus.mockClear();
  chatInterfaceMocks.sessionState.loadEarlierMessages.mockClear();
  chatInterfaceMocks.sessionState.loadAllMessages.mockClear();
  chatInterfaceMocks.sessionState.createDiff.mockClear();
  chatInterfaceMocks.sessionState.scrollToBottom.mockClear();
  chatInterfaceMocks.sessionState.scrollToBottomAndReset.mockClear();
  chatInterfaceMocks.sessionState.handleScroll.mockClear();
  chatInterfaceMocks.sessionState.loadSessionMessages.mockReset();
  chatInterfaceMocks.sessionState.loadSessionMessages.mockResolvedValue([]);

  chatInterfaceMocks.providerState.provider = 'codex';
  chatInterfaceMocks.providerState.setProvider.mockClear();
  chatInterfaceMocks.providerState.setClaudeModel.mockClear();
  chatInterfaceMocks.providerState.setCodexModel.mockClear();
  chatInterfaceMocks.providerState.setCodexInteractionMode.mockClear();
  chatInterfaceMocks.providerState.setCodexApprovalPolicy.mockClear();
  chatInterfaceMocks.providerState.setCodexReasoningEffort.mockClear();
  chatInterfaceMocks.providerState.handleCodexSessionCreated.mockClear();
  chatInterfaceMocks.providerState.setGeminiModel.mockClear();
  chatInterfaceMocks.providerState.pendingPermissionRequests = [];
  chatInterfaceMocks.providerState.setPendingPermissionRequests.mockClear();
  chatInterfaceMocks.providerState.cyclePermissionMode.mockClear();

  chatInterfaceMocks.composerState.input = '';
  chatInterfaceMocks.composerState.setInput.mockClear();
  chatInterfaceMocks.composerState.setThinkingMode.mockClear();
  chatInterfaceMocks.composerState.resetCommandMenuState.mockClear();
  chatInterfaceMocks.composerState.handleCommandSelect.mockClear();
  chatInterfaceMocks.composerState.handleToggleCommandMenu.mockClear();
  chatInterfaceMocks.composerState.selectFile.mockClear();
  chatInterfaceMocks.composerState.attachedImages = [];
  chatInterfaceMocks.composerState.setAttachedImages.mockClear();
  chatInterfaceMocks.composerState.getRootProps.mockClear();
  chatInterfaceMocks.composerState.getInputProps.mockClear();
  chatInterfaceMocks.composerState.openImagePicker.mockClear();
  chatInterfaceMocks.composerState.handleSubmit.mockClear();
  chatInterfaceMocks.composerState.handleInputChange.mockClear();
  chatInterfaceMocks.composerState.handleKeyDown.mockClear();
  chatInterfaceMocks.composerState.handlePaste.mockClear();
  chatInterfaceMocks.composerState.handleTextareaClick.mockClear();
  chatInterfaceMocks.composerState.handleTextareaInput.mockClear();
  chatInterfaceMocks.composerState.syncInputOverlayScroll.mockClear();
  chatInterfaceMocks.composerState.handleClearInput.mockClear();
  chatInterfaceMocks.composerState.handleAbortSession.mockClear();
  chatInterfaceMocks.composerState.handleTranscript.mockClear();
  chatInterfaceMocks.composerState.handlePermissionDecision.mockClear();
  chatInterfaceMocks.composerState.handleGrantToolPermission.mockClear();
  chatInterfaceMocks.composerState.handleInputFocusChange.mockClear();
}

function renderChatInterface(overrides: Partial<ComponentProps<typeof ChatInterface>> = {}) {
  const sendMessage = overrides.sendMessage ?? vi.fn(() => true);

  const props: ComponentProps<typeof ChatInterface> = {
    selectedProject,
    selectedSession,
    ws: {} as WebSocket,
    sendMessage,
    onFileOpen: vi.fn(),
    onInputFocusChange: vi.fn(),
    onSessionActive: vi.fn(),
    onSessionInactive: vi.fn(),
    onSessionProcessing: vi.fn(),
    onSessionNotProcessing: vi.fn(),
    processingSessions: new Set<string>(),
    onReplaceTemporarySession: vi.fn(),
    onNavigateToSession: vi.fn(),
    onShowSettings: vi.fn(),
    autoExpandTools: false,
    showRawParameters: false,
    showThinking: true,
    autoScrollToBottom: true,
    sendByCtrlEnter: false,
    externalMessageUpdate: 0,
    onShowAllTasks: null,
    ...overrides,
  };

  return {
    props,
    sendMessage,
    ...render(<ChatInterface {...props} />),
  };
}

describe('ChatInterface codex orchestration', () => {
  beforeEach(() => {
    resetChatInterfaceMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('requests pending permissions on mount for the active Codex session', async () => {
    const { sendMessage } = renderChatInterface();

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'get-pending-permissions',
        sessionId: 'codex-session-1',
        provider: 'codex',
      });
    });
  });

  it('re-syncs Codex session status and pending permissions after interactive requests settle', async () => {
    const { sendMessage } = renderChatInterface();

    await waitFor(() => {
      expect(chatInterfaceMocks.realtimeArgs).toBeTruthy();
    });

    sendMessage.mockClear();

    act(() => {
      chatInterfaceMocks.realtimeArgs.onCodexInteractiveRequestSettled();
    });

    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'check-session-status',
      sessionId: 'codex-session-1',
      provider: 'codex',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'get-pending-permissions',
      sessionId: 'codex-session-1',
      provider: 'codex',
    });
  });

  it('reloads Codex session messages and clears stuck loading state after websocket reconnect', async () => {
    chatInterfaceMocks.sessionState.loadSessionMessages.mockResolvedValue([
      { type: 'assistant', content: 'Recovered output', timestamp: 1 },
    ]);
    const { sendMessage } = renderChatInterface();

    await waitFor(() => {
      expect(chatInterfaceMocks.realtimeArgs).toBeTruthy();
    });

    sendMessage.mockClear();

    await act(async () => {
      await chatInterfaceMocks.realtimeArgs.onWebSocketReconnect();
    });

    expect(chatInterfaceMocks.sessionState.loadSessionMessages).toHaveBeenCalledWith(
      'demo-project',
      'codex-session-1',
      false,
      'codex',
    );
    expect(chatInterfaceMocks.sessionState.setChatMessages).toHaveBeenCalledWith([
      { type: 'assistant', content: 'Recovered output', timestamp: 1 },
    ]);
    expect(chatInterfaceMocks.sessionState.setIsLoading).toHaveBeenCalledWith(false);
    expect(chatInterfaceMocks.sessionState.setCanAbortSession).toHaveBeenCalledWith(false);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'get-pending-permissions',
      sessionId: 'codex-session-1',
      provider: 'codex',
    });
  });

  it('ignores reconnect results that arrive after the user switches sessions', async () => {
    let resolveMessages: ((messages: any[]) => void) | null = null;
    chatInterfaceMocks.sessionState.loadSessionMessages.mockImplementation(
      () => new Promise((resolve) => {
        resolveMessages = resolve;
      }),
    );

    const { props, rerender, sendMessage } = renderChatInterface();

    await waitFor(() => {
      expect(chatInterfaceMocks.realtimeArgs).toBeTruthy();
    });

    sendMessage.mockClear();
    chatInterfaceMocks.sessionState.setChatMessages.mockClear();
    chatInterfaceMocks.sessionState.setIsLoading.mockClear();
    chatInterfaceMocks.sessionState.setCanAbortSession.mockClear();

    const reconnectPromise = chatInterfaceMocks.realtimeArgs.onWebSocketReconnect();

    rerender(
      <ChatInterface
        {...props}
        selectedSession={{
          id: 'codex-session-2',
          __provider: 'codex',
        } as any}
      />,
    );

    await act(async () => {
      resolveMessages?.([{ type: 'assistant', content: 'Recovered output', timestamp: 1 }]);
      await reconnectPromise;
    });

    expect(chatInterfaceMocks.sessionState.setChatMessages).not.toHaveBeenCalled();
    expect(chatInterfaceMocks.sessionState.setIsLoading).not.toHaveBeenCalled();
    expect(chatInterfaceMocks.sessionState.setCanAbortSession).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'get-pending-permissions',
      sessionId: 'codex-session-2',
      provider: 'codex',
    });
  });

  it('marks in-flight Codex interactive requests failed after the timeout window', async () => {
    vi.useFakeTimers();
    chatInterfaceMocks.providerState.pendingPermissionRequests = [
      {
        requestId: 'req-1',
        provider: 'codex',
        requestKind: 'approval',
        toolName: 'Bash',
        deliveryState: 'submitting',
      },
    ];

    const { sendMessage } = renderChatInterface({ ws: null });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'get-pending-permissions',
      sessionId: 'codex-session-1',
      provider: 'codex',
    });
    expect(chatInterfaceMocks.providerState.pendingPermissionRequests).toEqual([
      expect.objectContaining({
        requestId: 'req-1',
        deliveryState: 'failed',
        deliveryError: 'Server did not confirm receipt of the response. Please submit again.',
      }),
    ]);
  });

  it('aborts the current Codex session when Escape is pressed during generation', () => {
    chatInterfaceMocks.sessionState.isLoading = true;
    chatInterfaceMocks.sessionState.canAbortSession = true;

    renderChatInterface();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(chatInterfaceMocks.composerState.handleAbortSession).toHaveBeenCalledTimes(1);
  });
});
