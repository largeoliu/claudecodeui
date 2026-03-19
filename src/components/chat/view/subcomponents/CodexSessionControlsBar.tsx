import { useTranslation } from 'react-i18next';
import { Pill, PillBar } from '../../../../shared/view/ui/PillBar';
import type { CodexApprovalPolicy, CodexInteractionMode } from '../../types/types';

interface CodexSessionControlsBarProps {
  interactionMode: CodexInteractionMode;
  onInteractionModeChange: (value: CodexInteractionMode) => void;
  approvalPolicy: CodexApprovalPolicy;
  onApprovalPolicyChange: (value: CodexApprovalPolicy) => void;
}

export default function CodexSessionControlsBar({
  interactionMode,
  onInteractionModeChange,
  approvalPolicy,
  onApprovalPolicyChange,
}: CodexSessionControlsBarProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="border-b border-border/70 bg-background/80 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('codex.interactionMode.title')}
          </span>
          <PillBar>
            <Pill
              isActive={interactionMode === 'edit'}
              onClick={() => onInteractionModeChange('edit')}
              className={interactionMode === 'edit' ? 'text-green-700 dark:text-green-300' : undefined}
            >
              {t('codex.interactionMode.modes.edit')}
            </Pill>
            <Pill
              isActive={interactionMode === 'plan'}
              onClick={() => onInteractionModeChange('plan')}
              className={interactionMode === 'plan' ? 'text-blue-700 dark:text-blue-300' : undefined}
            >
              {t('codex.interactionMode.modes.plan')}
            </Pill>
          </PillBar>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('codex.approvalPolicy.title')}
          </span>
          <PillBar>
            <Pill
              isActive={approvalPolicy === 'untrusted'}
              onClick={() => onApprovalPolicyChange('untrusted')}
              className={approvalPolicy === 'untrusted' ? 'text-amber-700 dark:text-amber-300' : undefined}
            >
              {t('codex.approvalPolicy.modes.untrusted')}
            </Pill>
            <Pill
              isActive={approvalPolicy === 'on-request'}
              onClick={() => onApprovalPolicyChange('on-request')}
              className={approvalPolicy === 'on-request' ? 'text-sky-700 dark:text-sky-300' : undefined}
            >
              {t('codex.approvalPolicy.modes.onRequest')}
            </Pill>
            <Pill
              isActive={approvalPolicy === 'never'}
              onClick={() => onApprovalPolicyChange('never')}
              className={approvalPolicy === 'never' ? 'text-green-700 dark:text-green-300' : undefined}
            >
              {t('codex.approvalPolicy.modes.never')}
            </Pill>
          </PillBar>
        </div>
      </div>
    </div>
  );
}
