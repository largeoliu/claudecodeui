import { useTranslation } from 'react-i18next';
import {
  CODEX_REASONING_EFFORTS,
  type CodexReasoningEffort,
} from '../../constants/codexReasoningEfforts';
import {
  coerceCodexReasoningEffortForModel,
  getCodexSupportedReasoningEfforts,
} from '../../../../../shared/modelConstants';
import PremiumSelector, { type SelectOption } from './PremiumSelector';
import { Brain } from 'lucide-react';
import { cn } from '../../../../lib/utils';

type CodexReasoningEffortSelectorProps = {
  model: string;
  selectedEffort: CodexReasoningEffort;
  onEffortChange: (effort: CodexReasoningEffort) => void;
  onClose?: () => void;
  className?: string;
};

export default function CodexReasoningEffortSelector({
  model,
  selectedEffort,
  onEffortChange,
  onClose,
  className = '',
}: CodexReasoningEffortSelectorProps) {
  const { t } = useTranslation('chat');
  const supportedEfforts = getCodexSupportedReasoningEfforts(model);

  const options: SelectOption[] = CODEX_REASONING_EFFORTS
    .filter((effort) => supportedEfforts.includes(effort.id))
    .map((effort) => ({
      id: effort.id,
      name: t(`codex.reasoning.modes.${effort.id}.name`, { defaultValue: effort.id }),
      icon: Brain,
      color: effort.color,
    }));

  const resolvedEffort = coerceCodexReasoningEffortForModel(model, selectedEffort) as CodexReasoningEffort;
  const currentEffort = CODEX_REASONING_EFFORTS.find((effort) => effort.id === resolvedEffort) || CODEX_REASONING_EFFORTS[0];

  return (
    <PremiumSelector
      selectedValue={resolvedEffort}
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
