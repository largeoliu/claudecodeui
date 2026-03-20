import { useTranslation } from 'react-i18next';
import PremiumSelector, { type SelectOption } from './PremiumSelector';
import { Edit3, Eye } from 'lucide-react';
import type { CodexInteractionMode } from '../../types/types';
import { cn } from '../../../../lib/utils';

type CodexInteractionModeSelectorProps = {
  codexInteractionMode: CodexInteractionMode;
  onInteractionModeChange: (mode: CodexInteractionMode) => void;
  className?: string;
};

export default function CodexInteractionModeSelector({
  codexInteractionMode,
  onInteractionModeChange,
  className = '',
}: CodexInteractionModeSelectorProps) {
  const { t } = useTranslation('chat');

  const options: SelectOption[] = [
    {
      id: 'edit',
      name: t('codex.interactionMode.modes.edit'),
      icon: Edit3,
      color: 'text-blue-400',
    },
    {
      id: 'plan',
      name: t('codex.interactionMode.modes.plan'),
      icon: Eye,
      color: 'text-purple-400',
    },
  ];

  return (
    <PremiumSelector
      selectedValue={codexInteractionMode}
      options={options}
      onChange={(val) => onInteractionModeChange(val as CodexInteractionMode)}
      className={cn("w-fit min-w-[100px]", className)}
      triggerIcon={Edit3}
    />
  );
}
