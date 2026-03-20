import { useTranslation } from 'react-i18next';
import { thinkingModes } from '../../constants/thinkingModes';
import PremiumSelector, { type SelectOption } from './PremiumSelector';
import { Brain } from 'lucide-react';
import { cn } from '../../../../lib/utils';

type ThinkingModeSelectorProps = {
  selectedMode: string;
  onModeChange: (mode: string) => void;
  onClose?: () => void;
  className?: string;
};

export default function ThinkingModeSelector({
  selectedMode,
  onModeChange,
  onClose,
  className = '',
}: ThinkingModeSelectorProps) {
  const { t } = useTranslation('chat');

  const options: SelectOption[] = thinkingModes.map((mode) => ({
    id: mode.id,
    name: t(`thinkingMode.modes.${mode.id}.name`, { defaultValue: mode.name }),
    icon: mode.icon || Brain,
    color: mode.color,
  }));

  const currentMode = thinkingModes.find(m => m.id === selectedMode) || thinkingModes[0];

  return (
    <PremiumSelector
      selectedValue={selectedMode}
      options={options}
      onChange={onModeChange}
      onClose={onClose}
      className={cn("w-fit min-w-[120px]", className)}
      triggerIcon={Brain}
      title={t('thinkingMode.buttonTitle', { mode: t(`thinkingMode.modes.${currentMode.id}.name`, { defaultValue: currentMode.name }) })}
    />
  );
}