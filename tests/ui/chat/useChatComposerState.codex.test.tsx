// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import { useChatComposerState } from '../../../src/components/chat/hooks/useChatComposerState';
import type { ChatMessage, PendingPermissionRequest } from '../../../src/components/chat/types/types';
import type { ProjectSession } from '../../../src/types/app';

const composerMocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  resetCommandMenuState: vi.fn(),
  handleCommandSelect: vi.fn(),
  handleToggleCommandMenu: vi.fn(),
  handleCommandInputChange: vi.fn(),
  handleCommandMenuKeyDown: vi.fn(() => false),
  selectFile: vi.fn(),
  setCursorPosition: vi.fn(),
  handleFileMentionsKeyDown: vi.fn(() => false),
  openImagePicker: vi.fn(),
}));

vi.mock('../../../src/utils/api.js', () => ({
  authenticatedFetch: composerMocks.authenticatedFetch,
}));

vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
    open: composerMocks.openImagePicker,
  }),
}));

vi.mock('../../../src/components/chat/hooks/useSlashCommands', () => ({
  useSlashCommands: () => ({
    slashCommands: [],
    slashCommandsCount: 0,
    filteredCommands: [],
    frequentCommands: [],
    commandQuery: '',
    showCommandMenu: false,
    selectedCommandIndex: 0,
    resetCommandMenuState: composerMocks.resetCommandMenuState,
    handleCommandSelect: composerMocks.handleCommandSelect,
    handleToggleCommandMenu: composerMocks.handleToggleCommandMenu,
    handleCommandInputChange: composerMocks.handleCommandInputChange,
    handleCommandMenuKeyDown: composerMocks.handleCommandMenuKeyDown,
  }),
}));

vi.mock('../../../src/components/chat/hooks/useFileMentions', () => ({
  useFileMentions: () => ({
    showFileDropdown: false,
    filteredFiles: [],
    selectedFileIndex: 0,
    renderInputWithMentions: (value: string) => value,
    selectFile: composerMocks.selectFile,
    setCursorPosition: composerMocks.setCursorPosition,
    handleFileMentionsKeyDown: composerMocks.handleFileMentionsKeyDown,
  }),
}));

type ComposerHarnessOptions = {
  currentSessionId?: string | null;
  selectedSession?: ProjectSession | null;
  pendingViewSession?: { sessionId: string | null; startedAt: number } | null;
  initialPendingPermissionRequests?: PendingPermissionRequest[];
  initialCanAbortSession?: boolean;
};

function renderComposerHarness(options: ComposerHarnessOptions = {}) {
  const selectedProject = {
    name: 'demo-project',
    displayName: 'Demo Project',
    fullPath: '/work/demo-project',
  } as any;

  const sendMessage = vi.fn(() => true);
  const onSessionActive = vi.fn();
  const onSessionProcessing = vi.fn();
  const scrollToBottom = vi.fn();
  const pendingViewSessionRef = { current: options.pendingViewSession ?? null };

  const { result } = renderHook(() => {
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [sessionMessages, setSessionMessages] = useState<any[]>([]);
    const [isLoadingState, setIsLoadingState] = useState(false);
    const [canAbortSessionState, setCanAbortSessionState] = useState(options.initialCanAbortSession ?? false);
    const [claudeStatusState, setClaudeStatusState] = useState<{
      text: string;
      tokens: number;
      can_interrupt: boolean;
    } | null>(null);
    const [isUserScrolledUpState, setIsUserScrolledUpState] = useState(true);
    const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>(
      options.initialPendingPermissionRequests ?? [],
    );

    const composerState = useChatComposerState({
      selectedProject,
      selectedSession: options.selectedSession ?? null,
      currentSessionId: options.currentSessionId ?? null,
      provider: 'codex',
      permissionMode: 'default',
      codexInteractionMode: 'plan',
      codexApprovalPolicy: 'never',
      cyclePermissionMode: vi.fn(),
      claudeModel: 'claude-sonnet-4',
      codexModel: 'gpt-5-codex',
      codexReasoningEffort: 'high',
      geminiModel: 'gemini-2.5-pro',
      isLoading: isLoadingState,
      canAbortSession: canAbortSessionState,
      tokenBudget: null,
      sendMessage,
      sendByCtrlEnter: false,
      onSessionActive,
      onSessionProcessing,
      pendingViewSessionRef,
      scrollToBottom,
      setChatMessages,
      setSessionMessages,
      setIsLoading: setIsLoadingState,
      setCanAbortSession: setCanAbortSessionState,
      setClaudeStatus: setClaudeStatusState,
      setIsUserScrolledUp: setIsUserScrolledUpState,
      pendingPermissionRequests,
      setPendingPermissionRequests,
    });

    return {
      ...composerState,
      chatMessages,
      sessionMessages,
      isLoadingState,
      canAbortSessionState,
      claudeStatusState,
      isUserScrolledUpState,
      pendingPermissionRequests,
    };
  });

  return {
    result,
    selectedProject,
    sendMessage,
    onSessionActive,
    onSessionProcessing,
    scrollToBottom,
    pendingViewSessionRef,
  };
}

describe('useChatComposerState codex flow', () => {
  beforeEach(() => {
    composerMocks.authenticatedFetch.mockReset();
    composerMocks.resetCommandMenuState.mockReset();
    composerMocks.handleCommandSelect.mockReset();
    composerMocks.handleToggleCommandMenu.mockReset();
    composerMocks.handleCommandInputChange.mockReset();
    composerMocks.handleCommandMenuKeyDown.mockReset();
    composerMocks.handleCommandMenuKeyDown.mockReturnValue(false);
    composerMocks.selectFile.mockReset();
    composerMocks.setCursorPosition.mockReset();
    composerMocks.handleFileMentionsKeyDown.mockReset();
    composerMocks.handleFileMentionsKeyDown.mockReturnValue(false);
    composerMocks.openImagePicker.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('sends a new Codex command with project, model, and reasoning settings', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000_000);
    const harness = renderComposerHarness();

    act(() => {
      harness.result.current.setInput('Inspect the failing test');
    });

    await waitFor(() => {
      expect(harness.result.current.input).toBe('Inspect the failing test');
    });

    await act(async () => {
      await harness.result.current.handleSubmit({ preventDefault: vi.fn() } as any);
    });

    expect(harness.sendMessage).toHaveBeenCalledWith({
      type: 'codex-command',
      command: 'Inspect the failing test',
      sessionId: undefined,
      options: {
        cwd: '/work/demo-project',
        projectPath: '/work/demo-project',
        sessionId: undefined,
        resume: false,
        model: 'gpt-5-codex',
        reasoningEffort: 'high',
        sessionSummary: 'Inspect the failing test',
        interactionMode: 'plan',
        approvalPolicy: 'never',
        images: [],
      },
    });
    expect(harness.result.current.chatMessages).toEqual([
      expect.objectContaining({
        type: 'user',
        content: 'Inspect the failing test',
        images: [],
      }),
    ]);
    expect(harness.pendingViewSessionRef.current).toEqual({
      sessionId: null,
      startedAt: 1_710_000_000_000,
    });
    expect(harness.onSessionActive).toHaveBeenCalledWith('new-session-1710000000000');
    expect(harness.onSessionProcessing).not.toHaveBeenCalled();
    expect(harness.result.current.isLoadingState).toBe(true);
    expect(harness.result.current.canAbortSessionState).toBe(false);
    expect(harness.result.current.claudeStatusState).toEqual({
      text: 'Processing',
      tokens: 0,
      can_interrupt: false,
    });
    expect(harness.result.current.isUserScrolledUpState).toBe(false);
    expect(harness.result.current.input).toBe('');
  });

  it('resumes an existing Codex session and marks it as processing', async () => {
    const harness = renderComposerHarness({
      currentSessionId: 'codex-session-1',
      selectedSession: {
        id: 'codex-session-1',
        __provider: 'codex',
        summary: 'Existing session summary',
      } as any,
    });

    act(() => {
      harness.result.current.setInput('Continue the refactor');
    });

    await waitFor(() => {
      expect(harness.result.current.input).toBe('Continue the refactor');
    });

    await act(async () => {
      await harness.result.current.handleSubmit({ preventDefault: vi.fn() } as any);
    });

    expect(harness.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'codex-command',
        sessionId: 'codex-session-1',
        options: expect.objectContaining({
          sessionId: 'codex-session-1',
          resume: true,
          sessionSummary: 'Existing session summary',
        }),
      }),
    );
    expect(harness.onSessionActive).toHaveBeenCalledWith('codex-session-1');
    expect(harness.onSessionProcessing).toHaveBeenCalledWith('codex-session-1');
  });

  it('uploads attached images before dispatching a Codex command', async () => {
    composerMocks.authenticatedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [{ data: 'data:image/png;base64,Zm9v', name: 'diagram.png' }],
      }),
    });

    const harness = renderComposerHarness();
    const imageFile = new File(['diagram'], 'diagram.png', { type: 'image/png' });

    act(() => {
      harness.result.current.setAttachedImages([imageFile]);
      harness.result.current.setInput('Review the attached diagram');
    });

    await waitFor(() => {
      expect(harness.result.current.input).toBe('Review the attached diagram');
    });

    await act(async () => {
      await harness.result.current.handleSubmit({ preventDefault: vi.fn() } as any);
    });

    expect(composerMocks.authenticatedFetch).toHaveBeenCalledWith(
      '/api/projects/demo-project/upload-images',
      expect.objectContaining({
        method: 'POST',
        headers: {},
        body: expect.any(FormData),
      }),
    );
    expect(harness.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          images: [{ data: 'data:image/png;base64,Zm9v', name: 'diagram.png' }],
        }),
      }),
    );
    expect(harness.result.current.chatMessages[0]).toEqual(
      expect.objectContaining({
        type: 'user',
        images: [{ data: 'data:image/png;base64,Zm9v', name: 'diagram.png' }],
      }),
    );
    expect(harness.result.current.attachedImages).toEqual([]);
  });

  it('surfaces Codex image upload failures without sending the command', async () => {
    composerMocks.authenticatedFetch.mockResolvedValue({
      ok: false,
    });

    const harness = renderComposerHarness();
    const imageFile = new File(['diagram'], 'diagram.png', { type: 'image/png' });

    act(() => {
      harness.result.current.setAttachedImages([imageFile]);
      harness.result.current.setInput('Review the attached diagram');
    });

    await waitFor(() => {
      expect(harness.result.current.input).toBe('Review the attached diagram');
    });

    await act(async () => {
      await harness.result.current.handleSubmit({ preventDefault: vi.fn() } as any);
    });

    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(harness.result.current.chatMessages).toEqual([
      expect.objectContaining({
        type: 'error',
        content: 'Failed to upload images: Failed to upload images',
      }),
    ]);
    expect(harness.result.current.isLoadingState).toBe(false);
  });

  it('aborts the best available concrete Codex session id', () => {
    sessionStorage.setItem('pendingSessionId', 'codex-storage-session');
    const harness = renderComposerHarness({
      currentSessionId: 'new-session-1',
      initialCanAbortSession: true,
      selectedSession: {
        id: 'codex-selected-session',
        __provider: 'codex',
      } as any,
      pendingViewSession: {
        sessionId: 'codex-pending-session',
        startedAt: Date.now(),
      },
    });

    act(() => {
      harness.result.current.handleAbortSession();
    });

    expect(harness.sendMessage).toHaveBeenLastCalledWith({
      type: 'abort-session',
      sessionId: 'codex-pending-session',
      provider: 'codex',
    });
  });
});
