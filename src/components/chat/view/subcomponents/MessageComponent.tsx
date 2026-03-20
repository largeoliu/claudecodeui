import { Suspense, lazy, memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type {
  ChatMessage,
  ClaudePermissionSuggestion,
  PermissionGrantResult,
  Provider,
} from '../../types/types';
import { formatUsageLimitText } from '../../utils/chatFormatting';
import { getClaudePermissionSuggestion } from '../../utils/chatPermissions';
import type { Project } from '../../../../types/app';
import { Terminal, MessageSquare, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { ToolRenderer, shouldHideToolResult } from '../../tools';

const Markdown = lazy(() =>
  import('./Markdown').then((module) => ({ default: module.Markdown }))
);

function DeferredMarkdown({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <Suspense fallback={<div className={className}>{children}</div>}>
      <Markdown className={className}>{children}</Markdown>
    </Suspense>
  );
}

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

type MessageComponentProps = {
  message: ChatMessage;
  prevMessage: ChatMessage | null;
  nextMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
};

type InteractiveOption = {
  number: string;
  text: string;
  isSelected: boolean;
};

type PermissionGrantState = 'idle' | 'granted' | 'error';

const MessageComponent = memo(({ message, prevMessage, nextMessage, createDiff, onFileOpen, onShowSettings, onGrantToolPermission, autoExpandTools, showRawParameters, showThinking, selectedProject, provider }: MessageComponentProps) => {
  const { t } = useTranslation('chat');
  const isGrouped = prevMessage && prevMessage.type === message.type &&
    ((prevMessage.type === 'assistant') ||
      (prevMessage.type === 'user') ||
      (prevMessage.type === 'tool') ||
      (prevMessage.type === 'error'));
  const isLastInGroup = !nextMessage || nextMessage.type !== message.type;
  const isUser = message.type === 'user';
  const messageRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const permissionSuggestion = getClaudePermissionSuggestion(message, provider);
  const [permissionGrantState, setPermissionGrantState] = useState<PermissionGrantState>('idle');


  useEffect(() => {
    setPermissionGrantState('idle');
  }, [permissionSuggestion?.entry, message.toolId]);

  useEffect(() => {
    const node = messageRef.current;
    if (!autoExpandTools || !node || !message.isToolUse) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isExpanded) {
            setIsExpanded(true);
            const details = node.querySelectorAll<HTMLDetailsElement>('details');
            details.forEach((detail) => {
              detail.open = true;
            });
          }
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(node);

    return () => {
      observer.unobserve(node);
    };
  }, [autoExpandTools, isExpanded, message.isToolUse]);

  const formattedTime = useMemo(() => new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), [message.timestamp]);
  const nextFormattedTime = useMemo(() => nextMessage ? new Date(nextMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null, [nextMessage]);
  const shouldShowTimestamp = message.type === 'user'
    || (message.type === 'assistant' && (!nextMessage || nextMessage.type === 'user' || formattedTime !== nextFormattedTime))
    || (isLastInGroup && (!nextMessage || formattedTime !== nextFormattedTime));
  const shouldHideThinkingMessage = Boolean(message.isThinking && !showThinking);

  if (shouldHideThinkingMessage) {
    return null;
  }

  return (
    <div
      ref={messageRef}
      data-message-timestamp={message.timestamp || undefined}
      className={cn(
        'chat-message animate-stagger-in group flex w-full flex-col gap-0.5 transition-all duration-300',
        message.type,
        isGrouped && 'grouped',
        message.type === 'user' ? 'items-end' : 'items-start'
      )}
    >
      {message.type === 'user' ? (
        /* User message bubble on the right */
        <div className="flex w-full flex-col items-end sm:w-auto sm:max-w-[85%] md:max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl">
          <div className="group min-w-[60px] rounded-lg border border-white/10 bg-white/[0.06] px-5 py-2 text-white/90 transition-all duration-300 hover:bg-white/[0.08] hover:border-white/20 shadow-lg shadow-black/10">
            <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed font-normal tracking-wide">
              {message.content}
            </div>
            {message.images && message.images.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {message.images.map((img, idx) => (
                  <img
                    key={img.name || idx}
                    src={img.data}
                    alt={img.name}
                    className="h-auto max-w-full cursor-pointer rounded-lg transition-opacity hover:opacity-90"
                    onClick={() => window.open(img.data, '_blank')}
                  />
                ))}
              </div>
            )}
          </div>
          {shouldShowTimestamp && (
            <div className="mt-0.5 flex w-full justify-end text-[10px] font-medium text-white/20 uppercase tracking-wider">
              <span>{formattedTime}</span>
            </div>
          )}
        </div>
      ) : message.isTaskNotification ? (
        /* Compact task notification on the left */
        <div className="w-full">
          <div className="flex items-center gap-2 py-0.5 opacity-60">
            <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${message.taskStatus === 'completed' ? 'bg-white/80' : 'bg-gray-500'}`} />
            <span className="text-xs text-gray-400">{message.content}</span>
          </div>
        </div>
      ) : (
        /* Claude/Error/Tool messages on the left */
        <div className="w-full flex flex-col items-start max-w-[95%] sm:max-w-[90%] md:max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl">
          <div className="w-full px-5 py-1">
            {message.isToolUse ? (
              <>
                <div className="flex flex-col">
                  <div className="flex flex-col">
                    <DeferredMarkdown className="prose prose-sm max-w-none dark:prose-invert">
                      {String(message.displayText || '')}
                    </DeferredMarkdown>
                  </div>
                </div>

                {message.toolInput && (
                  <ToolRenderer
                    toolName={message.toolName || 'UnknownTool'}
                    toolInput={message.toolInput}
                    toolResult={message.toolResult}
                    toolId={message.toolId}
                    mode="input"
                    onFileOpen={onFileOpen}
                    createDiff={createDiff}
                    selectedProject={selectedProject}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                    rawToolInput={typeof message.toolInput === 'string' ? message.toolInput : undefined}
                    isSubagentContainer={message.isSubagentContainer}
                    subagentState={message.subagentState}
                  />
                )}

                {/* Tool Result Section */}
                {message.toolResult && !shouldHideToolResult(message.toolName || 'UnknownTool', message.toolResult) && (
                  message.toolResult.isError ? (
                    // Error results - red error box with content
                    <div
                      id={`tool-result-${message.toolId}`}
                      className="relative mt-2 border-l-2 border-white/20 bg-white/5 p-3"
                    >
                      <div className="relative mb-2 flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span className="text-xs font-medium text-white/80">{t('messageTypes.error')}</span>
                      </div>
                      <div className="relative text-sm text-red-900 dark:text-red-100">
                         <DeferredMarkdown className="prose prose-sm prose-red max-w-none dark:prose-invert">
                            {String(message.toolResult.content || '')}
                         </DeferredMarkdown>
                        {permissionSuggestion && (
                          <div className="mt-4 border-t border-red-200/60 pt-3 dark:border-red-800/60">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!onGrantToolPermission) return;
                                  const result = onGrantToolPermission(permissionSuggestion);
                                  if (result?.success) {
                                    setPermissionGrantState('granted');
                                  } else {
                                    setPermissionGrantState('error');
                                  }
                                }}
                                disabled={permissionSuggestion.isAllowed || permissionGrantState === 'granted'}
                                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${permissionSuggestion.isAllowed || permissionGrantState === 'granted'
                                  ? 'cursor-default border-green-300/70 bg-green-100 text-green-800 dark:border-green-800/60 dark:bg-green-900/30 dark:text-green-200'
                                  : 'border-red-300/70 bg-white/80 text-red-700 hover:bg-white dark:border-red-800/60 dark:bg-gray-900/40 dark:text-red-200 dark:hover:bg-gray-900/70'
                                  }`}
                              >
                                {permissionSuggestion.isAllowed || permissionGrantState === 'granted'
                                  ? t('permissions.added')
                                  : t('permissions.grant', { tool: permissionSuggestion.toolName })}
                              </button>
                              {onShowSettings && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onShowSettings(); }}
                                  className="text-xs text-red-700 underline hover:text-red-800 dark:text-red-200 dark:hover:text-red-100"
                                >
                                  {t('permissions.openSettings')}
                                </button>
                              )}
                            </div>
                            <div className="mt-2 text-xs text-red-700/90 dark:text-red-200/80">
                              {t('permissions.addTo', { entry: permissionSuggestion.entry })}
                            </div>
                            {permissionGrantState === 'error' && (
                              <div className="mt-2 text-xs text-red-700 dark:text-red-200">
                                {t('permissions.error')}
                              </div>
                            )}
                            {(permissionSuggestion.isAllowed || permissionGrantState === 'granted') && (
                              <div className="mt-2 text-xs text-green-700 dark:text-green-200">
                                {t('permissions.retry')}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    // Non-error results - route through ToolRenderer (single source of truth)
                    <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                      <ToolRenderer
                        toolName={message.toolName || 'UnknownTool'}
                        toolInput={message.toolInput}
                        toolResult={message.toolResult}
                        toolId={message.toolId}
                        mode="result"
                        onFileOpen={onFileOpen}
                        createDiff={createDiff}
                        selectedProject={selectedProject}
                        autoExpandTools={autoExpandTools}
                        showRawParameters={showRawParameters}
                        rawToolInput={typeof message.toolInput === 'string' ? message.toolInput : undefined}
                      />
                    </div>
                  )
                )}
              </>
            ) : message.isInteractivePrompt ? (
              // Special handling for interactive prompts
              <div className="animate-stagger-in rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/80 text-zinc-950">
                    <Terminal className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <h4 className="mb-3 text-sm font-semibold text-white/90">
                      {t('interactive.title')}
                    </h4>
                    {(() => {
                      const lines = (message.content || '').split('\n').filter((line) => line.trim());
                      const questionLine = lines.find((line) => line.includes('?')) || lines[0] || '';
                      const options: InteractiveOption[] = [];

                      // Parse the menu options
                      lines.forEach((line) => {
                        const optionMatch = line.match(/[❯\s]*(\d+)\.\s+(.+)/);
                        if (optionMatch) {
                          const isSelected = line.includes('❯');
                          options.push({
                            number: optionMatch[1],
                            text: optionMatch[2].trim(),
                            isSelected
                          });
                        }
                      });
                      return (
                        <>
                          <p className="mb-4 text-sm text-white/80">
                            {questionLine}
                          </p>

                          {/* Option buttons */}
                          <div className="mb-4 space-y-2">
                            {options.map((option, idx) => (
                              <button
                                key={option.number}
                                className={cn(
                                  'w-full border px-4 py-3 text-left transition-all duration-200',
                                  option.isSelected
                                    ? 'border-white/20 bg-white/10 text-white shadow-md'
                                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
                                  idx === 0 && "rounded-t-lg",
                                  idx === options.length - 1 && "rounded-b-lg"
                                )}
                                disabled
                              >
                                <div className="flex items-center gap-3">
                                  <span className={cn(
                                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold',
                                    option.isSelected ? 'bg-white/20' : 'bg-white/10'
                                  )}>
                                    {option.number}
                                  </span>
                                  <span className="flex-1 text-sm font-medium sm:text-base">
                                    {option.text}
                                  </span>
                                  {option.isSelected && (
                                    <span className="text-lg">❯</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>

                          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                            <p className="mb-1 text-sm font-medium text-white/90">
                              {t('interactive.waiting')}
                            </p>
                            <p className="text-xs text-white/60">
                              {t('interactive.instruction')}
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : message.isThinking ? (
              /* Thinking messages - collapsible by default */
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <details className="group">
                  <summary className="flex cursor-pointer items-center gap-2 font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                    <svg className="h-3 w-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span>{t('thinking.completed', { defaultValue: '思考过程' })}</span>
                  </summary>
                  <div className="mt-2 border-l-2 border-gray-300 pl-4 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">
                    <DeferredMarkdown className="prose prose-sm prose-gray max-w-none dark:prose-invert">
                      {message.content}
                    </DeferredMarkdown>
                  </div>
                </details>
              </div>
            ) : (
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {/* Thinking accordion for reasoning */}
                {showThinking && message.reasoning && (
                  <details className="mb-3">
                    <summary className="cursor-pointer font-medium text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
                      {t('thinking.completed', { defaultValue: '思考过程' })}
                    </summary>
                    <div className="mt-2 border-l-2 border-gray-300 pl-4 text-sm italic text-gray-600 dark:border-gray-600 dark:text-gray-400">
                      <div className="whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </div>
                  </details>
                )}

                {(() => {
                  const content = formatUsageLimitText(String(message.content || ''));

                  // Detect if content is pure JSON (starts with { or [)
                  const trimmedContent = content.trim();
                  if ((trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
                    (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))) {
                    try {
                      const parsed = JSON.parse(trimmedContent);
                      const formatted = JSON.stringify(parsed, null, 2);

                      return (
                        <div className="my-2">
                          <div className="mb-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium">{t('json.response')}</span>
                          </div>
                          <div className="overflow-hidden rounded-lg border border-gray-600/30 bg-gray-800 dark:border-gray-700 dark:bg-gray-900">
                            <pre className="overflow-x-auto p-4">
                              <code className="block whitespace-pre font-mono text-sm text-gray-100 dark:text-gray-200">
                                {formatted}
                              </code>
                            </pre>
                          </div>
                        </div>
                      );
                    } catch {
                      // Not valid JSON, fall through to normal rendering
                    }
                  }

                  // Normal rendering for non-JSON content
                  return message.type === 'assistant' ? (
                    <DeferredMarkdown className="prose prose-sm prose-gray max-w-none dark:prose-invert">
                      {content}
                    </DeferredMarkdown>
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {shouldShowTimestamp && (
            <div className="mt-0.5 flex w-full items-center gap-2 text-[10px] font-medium text-white/20 uppercase tracking-wider px-2">
              <span>{formattedTime}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default MessageComponent;
