// @vitest-environment jsdom

import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import ChatComposer from '../../src/components/chat/view/subcomponents/ChatComposer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('../../src/components/chat/view/subcomponents/CommandMenu', () => ({
  default: () => null,
}));

vi.mock('../../src/components/chat/view/subcomponents/ImageAttachment', () => ({
  default: () => null,
}));

vi.mock('../../src/components/chat/view/subcomponents/PermissionRequestsBanner', () => ({
  default: () => null,
}));

vi.mock('../../src/components/chat/view/subcomponents/ChatInputControls', () => ({
  default: () => null,
}));

vi.mock('../../src/components/mic-button/view/MicButton', () => ({
  default: () => null,
}));

function buildProps(overrides: Partial<ComponentProps<typeof ChatComposer>> = {}): ComponentProps<typeof ChatComposer> {
  return {
    pendingPermissionRequests: [],
    handlePermissionDecision: vi.fn(),
    handleGrantToolPermission: vi.fn(() => ({ success: false })),
    claudeStatus: null,
    isLoading: false,
    canAbortSession: false,
    onAbortSession: vi.fn(),
    provider: 'codex',
    permissionMode: 'default',
    onModeSwitch: vi.fn(),
    thinkingMode: 'none',
    setThinkingMode: vi.fn(),
    codexInteractionMode: 'edit',
    setCodexInteractionMode: vi.fn(),
    codexApprovalPolicy: 'on-request',
    setCodexApprovalPolicy: vi.fn(),
    codexReasoningEffort: 'medium',
    setCodexReasoningEffort: vi.fn(),
    tokenBudget: null,
    slashCommandsCount: 0,
    onToggleCommandMenu: vi.fn(),
    hasInput: true,
    onClearInput: vi.fn(),
    isUserScrolledUp: false,
    hasMessages: false,
    onScrollToBottom: vi.fn(),
    onSubmit: vi.fn((event) => event.preventDefault?.()),
    isDragActive: false,
    attachedImages: [],
    onRemoveImage: vi.fn(),
    uploadingImages: new Map(),
    imageErrors: new Map(),
    showFileDropdown: false,
    filteredFiles: [],
    selectedFileIndex: 0,
    onSelectFile: vi.fn(),
    filteredCommands: [],
    selectedCommandIndex: 0,
    onCommandSelect: vi.fn(),
    onCloseCommandMenu: vi.fn(),
    isCommandMenuOpen: false,
    frequentCommands: [],
    getRootProps: vi.fn(() => ({})),
    getInputProps: vi.fn(() => ({})),
    openImagePicker: vi.fn(),
    inputHighlightRef: createRef<HTMLDivElement>(),
    renderInputWithMentions: (text: string) => text,
    textareaRef: createRef<HTMLTextAreaElement>(),
    input: 'Ship it',
    onInputChange: vi.fn(),
    onTextareaClick: vi.fn(),
    onTextareaKeyDown: vi.fn(),
    onTextareaPaste: vi.fn(),
    onTextareaScrollSync: vi.fn(),
    onTextareaInput: vi.fn(),
    onInputFocusChange: vi.fn(),
    isInputFocused: false,
    placeholder: 'Ask Codex',
    isTextareaExpanded: false,
    sendByCtrlEnter: false,
    onTranscript: vi.fn(),
    ...overrides,
  };
}

describe('ChatComposer', () => {
  it('submits on click, not on press start', () => {
    const onSubmit = vi.fn((event) => event.preventDefault?.());
    const { container } = render(<ChatComposer {...buildProps({ onSubmit })} />);

    const sendButton = container.querySelector('button[type="submit"]');
    expect(sendButton).not.toBeNull();

    fireEvent.mouseDown(sendButton!);
    fireEvent.touchStart(sendButton!);

    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(sendButton!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('keeps the loading control non-interruptible until abort is enabled', () => {
    render(<ChatComposer {...buildProps({ isLoading: true, canAbortSession: false })} />);

    expect(screen.getByRole('button', { name: 'Starting generation' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Stop Generation' })).not.toBeInTheDocument();
  });
});
