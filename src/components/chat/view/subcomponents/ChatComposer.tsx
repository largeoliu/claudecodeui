import { useTranslation } from 'react-i18next';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  SetStateAction,
  TouchEvent,
} from 'react';
import MicButton from '../../../mic-button/view/MicButton';
import type { CodexReasoningEffort } from '../../constants/codexReasoningEfforts';
import type { CodexApprovalPolicy, CodexInteractionMode, PendingPermissionRequest, PermissionMode, Provider } from '../../types/types';
import CommandMenu from './CommandMenu';
import ImageAttachment from './ImageAttachment';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import ChatInputControls from './ChatInputControls';

interface MentionableFile {
  name: string;
  path: string;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  claudeStatus: { text: string; tokens: number; can_interrupt: boolean } | null;
  isLoading: boolean;
  onAbortSession: () => void;
  provider: Provider | string;
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  thinkingMode: string;
  setThinkingMode: Dispatch<SetStateAction<string>>;
  codexInteractionMode: CodexInteractionMode;
  setCodexInteractionMode: (value: CodexInteractionMode) => void;
  codexApprovalPolicy: CodexApprovalPolicy;
  setCodexApprovalPolicy: (value: CodexApprovalPolicy) => void;
  codexReasoningEffort: CodexReasoningEffort;
  setCodexReasoningEffort: (effort: CodexReasoningEffort) => void;
  tokenBudget: { used?: number; total?: number } | null;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  attachedImages: File[];
  onRemoveImage: (index: number) => void;
  uploadingImages: Map<string, number>;
  imageErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openImagePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  isInputFocused?: boolean;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
  onTranscript: (text: string) => void;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  claudeStatus,
  isLoading,
  onAbortSession,
  provider,
  permissionMode,
  onModeSwitch,
  thinkingMode,
  setThinkingMode,
  codexInteractionMode,
  setCodexInteractionMode,
  codexApprovalPolicy,
  setCodexApprovalPolicy,
  codexReasoningEffort,
  setCodexReasoningEffort,
  tokenBudget,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
  onSubmit,
  isDragActive,
  attachedImages,
  onRemoveImage,
  uploadingImages,
  imageErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openImagePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  isInputFocused,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
  onTranscript,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const textareaRect = textareaRef.current?.getBoundingClientRect();
  const commandMenuPosition = {
    top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
    left: textareaRect ? textareaRect.left : 16,
    bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
  };

  // Hide the normal composer while the session is blocked on a dedicated interactive panel.
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion' || r.toolName === 'CodexTerminalInput'
  );

  // On mobile, when input is focused, float the input box at the bottom
  const mobileFloatingClass = isInputFocused
    ? 'max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:z-50 max-sm:bg-background max-sm:shadow-[0_-4px_20px_rgba(0,0,0,0.15)]'
    : '';

  return (
    <div className={`relative flex-shrink-0 p-2 pb-2 sm:p-4 sm:pb-4 md:p-4 md:pb-6 ${mobileFloatingClass}`}>
      {/* Scroll to bottom floating pill */}
      {isUserScrolledUp && hasMessages && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex -translate-y-full justify-center pb-6">
          <button
            type="button"
            onClick={onScrollToBottom}
            className="pointer-events-auto flex items-center justify-center gap-1.5 rounded-full border border-border/40 bg-background/95 px-3 py-1.5 text-[11px] font-medium text-foreground shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent/80 hover:shadow-md"
            title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            <span>{t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}</span>
          </button>
        </div>
      )}


      <div className="mx-auto mb-3 max-w-6xl">
        <PermissionRequestsBanner
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
        />

        {!hasQuestionPanel && <ChatInputControls
          permissionMode={permissionMode}
          onModeSwitch={onModeSwitch}
          provider={provider}
          thinkingMode={thinkingMode}
          setThinkingMode={setThinkingMode}
          codexInteractionMode={codexInteractionMode}
          onInteractionModeChange={setCodexInteractionMode}
          approvalPolicy={codexApprovalPolicy}
          onApprovalPolicyChange={setCodexApprovalPolicy}
          codexReasoningEffort={codexReasoningEffort}
          setCodexReasoningEffort={setCodexReasoningEffort}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={onToggleCommandMenu}
          hasInput={hasInput}
          onClearInput={onClearInput}
        />}
      </div>

      {!hasQuestionPanel && <form onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void} className="relative mx-auto max-w-6xl">
        {isDragActive && (
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
            <div className="rounded-xl border border-border/30 bg-card p-4 shadow-lg">
              <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-sm font-medium">Drop images here</p>
            </div>
          </div>
        )}

        {attachedImages.length > 0 && (
          <div className="mb-2 rounded-xl bg-muted/40 p-2">
            <div className="flex flex-wrap gap-2">
              {attachedImages.map((file, index) => (
                <ImageAttachment
                  key={index}
                  file={file}
                  onRemove={() => onRemoveImage(index)}
                  uploadProgress={uploadingImages.get(file.name)}
                  error={imageErrors.get(file.name)}
                />
              ))}
            </div>
          </div>
        )}

        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/95 shadow-lg backdrop-blur-md">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`cursor-pointer touch-manipulation border-b border-border/30 px-4 py-3 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground hover:bg-accent/50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-sm font-medium">{file.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <div
          {...getRootProps()}
          className={`relative overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-sm backdrop-blur-sm transition-all duration-200 focus-within:border-primary/30 focus-within:shadow-md focus-within:ring-1 focus-within:ring-primary/15 ${
            isTextareaExpanded ? 'chat-input-expanded' : ''
          }`}
        >
          <input {...getInputProps()} />
          <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
            <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words py-1.5 pl-12 pr-20 text-base leading-6 text-transparent sm:py-4 sm:pr-40">
              {renderInputWithMentions(input)}
            </div>
          </div>

          <div className="relative z-10">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={pendingPermissionRequests.length > 0 ? t('input.permissionRequired', { defaultValue: '请先处理上方的授权请求...' }) : placeholder}
              className="chat-input-placeholder block max-h-[40vh] min-h-[50px] w-full resize-none overflow-y-auto rounded-2xl bg-transparent py-1.5 pl-12 pr-24 text-base leading-6 text-foreground placeholder-muted-foreground/50 transition-all duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 sm:max-h-[300px] sm:min-h-[80px] sm:py-4 sm:pr-40"
              style={{ height: '50px' }}
              disabled={pendingPermissionRequests.length > 0}
            />

            <button
              type="button"
              onClick={openImagePicker}
              className="absolute left-2 top-1/2 -translate-y-1/2 transform rounded-xl p-2 transition-colors hover:bg-accent/60"
              title={t('input.attachImages')}
            >
              <svg className="h-5 w-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </button>

            <div className="absolute right-16 top-1/2 -translate-y-1/2 transform sm:right-16" style={{ display: 'none' }}>
              <MicButton onTranscript={onTranscript} className="h-10 w-10 sm:h-10 sm:w-10" />
            </div>

            {isLoading ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onAbortSession();
                }}
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 transform items-center justify-center rounded-xl bg-foreground text-background transition-all duration-200 hover:scale-105 hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-foreground/30 focus:ring-offset-1 focus:ring-offset-background sm:h-11 sm:w-11"
                aria-label={t('claudeStatus.controls.stopGeneration', { defaultValue: 'Stop Generation' })}
                title={t('claudeStatus.controls.stopGeneration', { defaultValue: 'Stop Generation' })}
              >
                <div className="relative flex items-center justify-center">
                  <svg className="absolute h-6 w-6 animate-spin text-background/30" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <svg className="z-10 h-3.5 w-3.5 text-background sm:h-4 sm:w-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </div>
              </button>
            ) : (
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5 transform">
                {hasInput && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClearInput();
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/40 bg-background/50 text-muted-foreground transition-all duration-200 hover:bg-accent/60 hover:text-foreground sm:h-9 sm:w-9"
                    title={t('input.clearInput', { defaultValue: 'Clear input' })}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
                <button
                  type="submit"
                  disabled={(!input.trim() && attachedImages.length === 0) || pendingPermissionRequests.length > 0}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSubmit(event);
                  }}
                  onTouchStart={(event) => {
                    event.preventDefault();
                    onSubmit(event);
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary transition-all duration-200 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1 focus:ring-offset-background disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground sm:h-11 sm:w-11"
                >
                  <svg className="h-4 w-4 rotate-90 transform text-primary-foreground sm:h-[18px] sm:w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            )}

            <div
              className={`pointer-events-none absolute bottom-1 left-12 right-14 hidden text-xs text-muted-foreground/50 transition-opacity duration-200 sm:right-40 sm:block ${
                input.trim() ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {sendByCtrlEnter ? t('input.hintText.ctrlEnter') : t('input.hintText.enter')}
            </div>
          </div>
        </div>
      </form>}
    </div>
  );
}
