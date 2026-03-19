import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CodexReasoningEffort } from '../../constants/codexReasoningEfforts';
import type { CodexApprovalPolicy, CodexInteractionMode, PermissionMode, Provider } from '../../types/types';
import CodexReasoningEffortSelector from './CodexReasoningEffortSelector';
import ThinkingModeSelector from './ThinkingModeSelector';
import { Pill, PillBar } from '../../../../shared/view/ui/PillBar';

interface ChatInputControlsProps {
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  provider: Provider | string;
  thinkingMode: string;
  setThinkingMode: React.Dispatch<React.SetStateAction<string>>;
  codexInteractionMode?: CodexInteractionMode;
  onInteractionModeChange?: (value: CodexInteractionMode) => void;
  approvalPolicy?: CodexApprovalPolicy;
  onApprovalPolicyChange?: (value: CodexApprovalPolicy) => void;
  codexReasoningEffort: CodexReasoningEffort;
  setCodexReasoningEffort: (effort: CodexReasoningEffort) => void;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
}

export default function ChatInputControls({
  permissionMode,
  onModeSwitch,
  provider,
  thinkingMode,
  setThinkingMode,
  codexInteractionMode,
  onInteractionModeChange,
  approvalPolicy,
  onApprovalPolicyChange,
  codexReasoningEffort,
  setCodexReasoningEffort,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
}: ChatInputControlsProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
      {provider !== 'codex' && (
        <button
          type="button"
          onClick={onModeSwitch}
          className={`rounded-lg border px-2.5 py-1 text-sm font-medium transition-all duration-200 sm:px-3 sm:py-1.5 ${permissionMode === 'acceptEdits'
              ? 'border-green-300/60 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-600/40 dark:bg-green-900/15 dark:text-green-300 dark:hover:bg-green-900/25'
              : 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
            }`}
          title={t('input.clickToChangeMode')}
        >
          <div className="flex items-center gap-1.5">
            <div
              className={`h-1.5 w-1.5 rounded-full ${permissionMode === 'acceptEdits'
                  ? 'bg-green-500'
                  : 'bg-primary'
                }`}
            />
            <span>
              {permissionMode === 'acceptEdits' && t('codex.modes.acceptEdits')}
              {permissionMode === 'plan' && t('codex.modes.plan')}
              {(permissionMode === 'default' || permissionMode === 'bypassPermissions') && t('codex.modes.acceptEdits')}
            </span>
          </div>
        </button>
      )}

      {provider === 'claude' && (
        <ThinkingModeSelector selectedMode={thinkingMode} onModeChange={setThinkingMode} onClose={() => { }} className="" />
      )}

      {provider === 'codex' && codexInteractionMode && onInteractionModeChange && (
        <div className="flex items-center gap-1.5">
          <PillBar className="p-[2px] h-8">
            <Pill
              isActive={codexInteractionMode === 'edit'}
              onClick={() => onInteractionModeChange('edit')}
              className={`px-2 py-1 text-[11px] h-full ${codexInteractionMode === 'edit' ? 'text-green-700 dark:text-green-300' : ''}`}
            >
              {t('codex.interactionMode.modes.edit')}
            </Pill>
            <Pill
              isActive={codexInteractionMode === 'plan'}
              onClick={() => onInteractionModeChange('plan')}
              className={`px-2 py-1 text-[11px] h-full ${codexInteractionMode === 'plan' ? 'text-blue-700 dark:text-blue-300' : ''}`}
            >
              {t('codex.interactionMode.modes.plan')}
            </Pill>
          </PillBar>
        </div>
      )}

      {provider === 'codex' && approvalPolicy && onApprovalPolicyChange && (
        <div className="flex items-center gap-1.5">
          <PillBar className="p-[2px] h-8">
            <Pill
              isActive={approvalPolicy === 'untrusted'}
              onClick={() => onApprovalPolicyChange('untrusted')}
              className={`px-2 py-1 text-[11px] h-full ${approvalPolicy === 'untrusted' ? 'text-amber-700 dark:text-amber-300' : ''}`}
            >
              {t('codex.approvalPolicy.modes.untrusted')}
            </Pill>
            <Pill
              isActive={approvalPolicy === 'on-request'}
              onClick={() => onApprovalPolicyChange('on-request')}
              className={`px-2 py-1 text-[11px] h-full ${approvalPolicy === 'on-request' ? 'text-sky-700 dark:text-sky-300' : ''}`}
            >
              {t('codex.approvalPolicy.modes.onRequest')}
            </Pill>
            <Pill
              isActive={approvalPolicy === 'never'}
              onClick={() => onApprovalPolicyChange('never')}
              className={`px-2 py-1 text-[11px] h-full ${approvalPolicy === 'never' ? 'text-green-700 dark:text-green-300' : ''}`}
            >
              {t('codex.approvalPolicy.modes.never')}
            </Pill>
          </PillBar>
        </div>
      )}

      {provider === 'codex' && (
        <CodexReasoningEffortSelector
          selectedEffort={codexReasoningEffort}
          onEffortChange={setCodexReasoningEffort}
          onClose={() => { }}
          className="h-8"
        />
      )}





    </div>
  );
}
