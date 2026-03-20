import { useTranslation } from 'react-i18next';
import {
  CODEX_REASONING_EFFORTS,
  type CodexReasoningEffort,
} from '../../constants/codexReasoningEfforts';
import PremiumSelector, { type SelectOption } from './PremiumSelector';
import { Brain } from 'lucide-react';
import { cn } from '../../../../lib/utils';

type CodexReasoningEffortSelectorProps = {
  selectedEffort: CodexReasoningEffort;
  onEffortChange: (effort: CodexReasoningEffort) => void;
  onClose?: () => void;
  className?: string;
};

export default function CodexReasoningEffortSelector({
  selectedEffort,
  onEffortChange,
  onClose,
  className = '',
}: CodexReasoningEffortSelectorProps) {
  const { t } = useTranslation('chat');

  const options: SelectOption[] = CODEX_REASONING_EFFORTS.map((effort) => ({
    id: effort.id,
    name: t(`codex.reasoning.modes.${effort.id}.name`, { defaultValue: effort.id }),
    icon: Brain,
    color: effort.color,
  }));

  const currentEffort = CODEX_REASONING_EFFORTS.find(e => e.id === selectedEffort) || CODEX_REASONING_EFFORTS[0];

  return (
    <PremiumSelector
      selectedValue={selectedEffort}
      options={options}
      onChange={(val) => onEffortChange(val as CodexReasoningEffort)}
      onClose={onClose}
      className={cn("w-fit min-w-[100px]", className)}
      triggerIcon={Brain}
      title={t('codex.reasoning.buttonTitle', {
        mode: t(`codex.reasoning.modes.${currentEffort.id}.name`, { defaultValue: currentEffort.id }),
      })}
    />
  );
}
