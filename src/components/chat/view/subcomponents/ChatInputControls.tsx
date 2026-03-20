import React from 'react';
import { useTranslation } from 'react-i18next';
import { CODEX_MODELS } from '../../../../../shared/modelConstants';
import type { CodexReasoningEffort } from '../../constants/codexReasoningEfforts';
import type { CodexApprovalPolicy, CodexInteractionMode, PermissionMode, Provider } from '../../types/types';
import CodexReasoningEffortSelector from './CodexReasoningEffortSelector';
import ThinkingModeSelector from './ThinkingModeSelector';
import CodexModelSelector from './CodexModelSelector';
import CodexApprovalSelector from './CodexApprovalSelector';
import CodexInteractionModeSelector from './CodexInteractionModeSelector';
import { cn } from '../../../../lib/utils';

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
  codexModel?: string;
  onCodexModelChange?: (model: string) => void;
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
  codexModel,
  onCodexModelChange,
  codexReasoningEffort,
  setCodexReasoningEffort,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
}: ChatInputControlsProps) {
  const { t } = useTranslation('chat');

  const isPermissionModeActive = permissionMode === 'acceptEdits' || permissionMode === 'default' || permissionMode === 'bypassPermissions';

  return (
    <div className="no-scrollbar flex w-full flex-nowrap items-center gap-2 overflow-x-auto px-1 scroll-smooth py-0.5 pt-80 -mt-80">
      {provider === 'codex' && codexModel && onCodexModelChange && (
        <div className="flex-shrink-0">
          <CodexModelSelector
            codexModel={codexModel}
            onCodexModelChange={onCodexModelChange}
          />
        </div>
      )}

      {provider === 'codex' && (
        <div className="flex-shrink-0">
          <CodexReasoningEffortSelector
            selectedEffort={codexReasoningEffort}
            onEffortChange={setCodexReasoningEffort}
            onClose={() => { }}
          />
        </div>
      )}

      {provider === 'claude' && (
        <div className="flex-shrink-0">
          <ThinkingModeSelector
            selectedMode={thinkingMode}
            onModeChange={setThinkingMode}
            onClose={() => { }}
          />
        </div>
      )}

      {provider !== 'codex' && provider !== 'claude' && (
        <div className="flex-shrink-0">
          <button
            type="button"
            onClick={onModeSwitch}
            className={cn(
              'flex items-center gap-2 rounded-lg h-8 px-4 text-[12px] font-bold transition-all duration-500 border relative overflow-hidden group',
              isPermissionModeActive
                ? 'bg-white border-white text-black shadow-[0_0_20px_rgba(255,255,255,0.2)] scale-[1.02]'
                : 'bg-white/[0.03] border-white/[0.08] text-white/40 hover:bg-white/[0.06] hover:text-white/70 hover:border-white/10'
            )}
            title={t('input.clickToChangeMode')}
          >
            <div className={cn(
              'h-1.5 w-1.5 rounded-full transition-all duration-500 relative z-10',
              isPermissionModeActive ? 'bg-black shadow-[0_0_8px_rgba(0,0,0,0.5)]' : 'bg-white/20'
            )} />
            <span className="relative z-10 uppercase tracking-tight">
              {isPermissionModeActive ? t('codex.modes.acceptEdits') : t('codex.modes.plan')}
            </span>
            {isPermissionModeActive && (
               <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            )}
          </button>
        </div>
      )}

      {provider === 'codex' && codexInteractionMode && onInteractionModeChange && (
        <div className="flex-shrink-0">
          <CodexInteractionModeSelector
            codexInteractionMode={codexInteractionMode}
            onInteractionModeChange={onInteractionModeChange}
          />
        </div>
      )}

      {provider === 'codex' && approvalPolicy && onApprovalPolicyChange && (
        <div className="flex-shrink-0">
          <CodexApprovalSelector
            approvalPolicy={approvalPolicy}
            onApprovalPolicyChange={onApprovalPolicyChange}
          />
        </div>
      )}
    </div>
  );
}
