import { useTranslation } from 'react-i18next';
import { CODEX_MODELS } from '../../../../../shared/modelConstants';
import PremiumSelector, { type SelectOption } from './PremiumSelector';
import { Box } from 'lucide-react';
import { cn } from '../../../../lib/utils';

type CodexModelSelectorProps = {
  codexModel: string;
  onCodexModelChange: (model: string) => void;
  className?: string;
};

export default function CodexModelSelector({
  codexModel,
  onCodexModelChange,
  className = '',
}: CodexModelSelectorProps) {
  const { t } = useTranslation('chat');

  const options: SelectOption[] = CODEX_MODELS.OPTIONS.map((opt) => ({
    id: opt.value,
    name: opt.label,
    icon: Box,
  }));

  return (
    <PremiumSelector
      selectedValue={codexModel}
      options={options}
      onChange={onCodexModelChange}
      className={cn("w-fit min-w-[160px]", className)}
      triggerIcon={Box}
      title={t('providerSelection.selectModel')}
    />
  );
}
