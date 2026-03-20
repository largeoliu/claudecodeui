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
import { cn } from '../../../../lib/utils';

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
  canAbortSession: boolean;
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
  codexModel: string;
  setCodexModel: (model: string) => void;
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
  canAbortSession,
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
  codexModel,
  setCodexModel,
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
    ? 'max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:z-50 max-sm:bg-background max-sm:border-t max-sm:border-white/10 max-sm:shadow-2xl'
    : '';
  const showAbortButton = isLoading && canAbortSession;
  const showPendingAbortState = isLoading && !canAbortSession;

  return (
    <div className={`relative flex-shrink-0 p-2 pb-1 sm:p-4 sm:pb-2 md:p-4 md:pb-2 ${mobileFloatingClass}`}>
      {/* Scroll to bottom floating pill */}
      {isUserScrolledUp && hasMessages && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex -translate-y-full justify-center pb-8">
          <button
            type="button"
            onClick={onScrollToBottom}
            className="pointer-events-auto flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-[12px] font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:bg-white/20 hover:scale-105 active:scale-95"
            title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            <span>{t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}</span>
          </button>
        </div>
      )}


      <div className="mb-2 w-full">
        <PermissionRequestsBanner
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
        />
      </div>

      {!hasQuestionPanel && <form onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void} className="relative w-full group/composer">
        {isDragActive && (
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-white/20 bg-white/5 backdrop-blur-sm">
            <div className="rounded-lg border border-white/10 bg-[#121212]/90 p-6 shadow-2xl premium-glow">
              <svg className="mx-auto mb-2 h-8 w-8 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-bold text-white/90 uppercase tracking-widest">Release to Upload</p>
            </div>
          </div>
        )}

        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-lg border border-border/50 bg-card/95 shadow-lg backdrop-blur-md">
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
          className={cn(
            "relative overflow-hidden rounded-lg border border-white/[0.06] bg-[#1a1a1a]/40 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-3xl transition-all duration-500",
            isInputFocused ? "border-white/15 bg-[#1a1a1a]/60 shadow-[0_20px_60px_rgba(0,0,0,0.6)] ring-1 ring-white/5" : "hover:border-white/10",
            isTextareaExpanded ? 'chat-input-expanded' : ''
          )}
        >
          <input {...getInputProps()} />
          
          {/* Integrated Image Previews */}
          {attachedImages.length > 0 && (
            <div className="px-2 pt-2 border-b border-white/[0.04]">
              <div className="flex flex-wrap gap-2 pb-2 overflow-x-auto no-scrollbar">
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

          <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
            <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words py-1.5 pl-10 pr-18 text-[15px] leading-[24px] text-transparent sm:py-1.5 sm:pr-18 uppercase tracking-tight">
              {renderInputWithMentions(input)}
            </div>
          </div>

          <div className="relative z-10 flex items-end min-h-[36px] sm:min-h-[36px]">
            <button
              type="button"
              onClick={openImagePicker}
              className="mb-1 ml-1 sm:mb-1 sm:ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-white/30 transition-all duration-300 hover:bg-white/5 hover:text-white/60 focus:outline-none focus:bg-white/10"
              title={t('input.attachImages')}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              rows={1}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={pendingPermissionRequests.length > 0 ? t('input.permissionRequired') : placeholder}
              className="chat-input-placeholder block flex-1 max-h-[108px] min-h-[36px] w-full resize-none overflow-y-auto rounded-lg bg-transparent py-1.5 px-2 text-[15px] leading-[24px] text-white/90 placeholder-white/20 transition-all duration-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 sm:max-h-[108px] sm:min-h-[36px] sm:py-1.5"
              style={{ height: '36px' }}
              disabled={pendingPermissionRequests.length > 0}
            />

            <div className="mb-1 mr-1 sm:mb-1 sm:mr-1 flex items-center gap-1">
              {hasInput && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onClearInput();
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-white/20 transition-all duration-300 hover:bg-white/5 hover:text-white/50"
                  title={t('input.clearInput')}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}

              {showAbortButton ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onAbortSession();
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-black transition-all duration-300 hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                  title={t('claudeStatus.controls.stopGeneration')}
                >
                   <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="1.5" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={(!input.trim() && attachedImages.length === 0) || pendingPermissionRequests.length > 0}
                  className={cn(
                    "group/send flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-500 active:scale-95 disabled:scale-100 disabled:opacity-20 disabled:grayscale",
                    input.trim() || attachedImages.length > 0
                      ? "bg-gradient-to-br from-white via-white to-white/90 text-black shadow-[0_10px_25px_rgba(255,255,255,0.15)] premium-glow hover:scale-[1.08] hover:shadow-[0_10px_35px_rgba(255,255,255,0.25)]"
                      : "bg-white/[0.05] text-white/20"
                  )}
                  title={t('input.sendMessage')}
                >
                  <svg 
                    className={cn(
                      "h-[14px] w-[14px] transform transition-transform duration-500",
                      input.trim() ? "translate-x-0.5 -translate-y-0.5 rotate-[-45deg]" : ""
                    )} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {!hasQuestionPanel && (
          <div className="animate-stagger-in mt-1">
             <ChatInputControls
              permissionMode={permissionMode}
              onModeSwitch={onModeSwitch}
              provider={provider}
              thinkingMode={thinkingMode}
              setThinkingMode={setThinkingMode}
              codexInteractionMode={codexInteractionMode}
              onInteractionModeChange={setCodexInteractionMode}
              approvalPolicy={codexApprovalPolicy}
              onApprovalPolicyChange={setCodexApprovalPolicy}
              codexModel={codexModel}
              onCodexModelChange={setCodexModel}
              codexReasoningEffort={codexReasoningEffort}
              setCodexReasoningEffort={setCodexReasoningEffort}
              slashCommandsCount={slashCommandsCount}
              onToggleCommandMenu={onToggleCommandMenu}
              hasInput={hasInput}
              onClearInput={onClearInput}
            />
          </div>
        )}
      </form>}
    </div>
  );
}
