import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CODEX_REASONING_EFFORTS,
  DEFAULT_CODEX_REASONING_EFFORT,
  type CodexReasoningEffort,
} from '../../constants/codexReasoningEfforts';

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
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onClose?.();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const currentEffort = CODEX_REASONING_EFFORTS.find((effort) => effort.id === selectedEffort)
    || CODEX_REASONING_EFFORTS.find((effort) => effort.id === DEFAULT_CODEX_REASONING_EFFORT)
    || CODEX_REASONING_EFFORTS[0];

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700 transition-all duration-200 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-300 dark:hover:bg-emerald-950"
        title={t('codex.reasoning.buttonTitle', {
          mode: t(`codex.reasoning.modes.${currentEffort.id}.name`, { defaultValue: currentEffort.id }),
          defaultValue: 'Codex reasoning effort: {{mode}}',
        })}
      >
        <Brain className={`h-4 w-4 ${currentEffort.color}`} />
        <span>
          {t('codex.reasoning.shortLabel', { defaultValue: 'Reasoning' })}
          {': '}
          {t(`codex.reasoning.modes.${currentEffort.id}.name`, { defaultValue: currentEffort.id })}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 z-20 mb-2 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t('codex.reasoning.title', { defaultValue: 'Reasoning Effort' })}
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('codex.reasoning.description', {
                    defaultValue: 'Control how much Codex thinks before answering.',
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onClose?.();
                }}
                className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>
          </div>

          <div className="py-1">
            {CODEX_REASONING_EFFORTS.map((effort) => {
              const isSelected = effort.id === selectedEffort;

              return (
                <button
                  key={effort.id}
                  type="button"
                  onClick={() => {
                    onEffortChange(effort.id);
                    setIsOpen(false);
                    onClose?.();
                  }}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${isSelected ? 'bg-gray-50 dark:bg-gray-700' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <Brain className={`mt-0.5 h-4 w-4 ${effort.color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                          {t(`codex.reasoning.modes.${effort.id}.name`, { defaultValue: effort.id })}
                        </span>
                        {isSelected && (
                          <span className={`rounded border px-2 py-0.5 text-xs ${effort.badge}`}>
                            {t('codex.reasoning.active', { defaultValue: 'Active' })}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {t(`codex.reasoning.modes.${effort.id}.description`, {
                          defaultValue:
                            effort.id === 'low'
                              ? 'Faster responses for routine work.'
                              : effort.id === 'high'
                                ? 'Deeper reasoning for harder problems.'
                                : 'Balanced speed and depth for most tasks.',
                        })}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="border-t border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              <strong>{t('codex.reasoning.tipLabel', { defaultValue: 'Tip:' })}</strong>{' '}
              {t('codex.reasoning.tip', {
                defaultValue: 'Higher effort can improve complex tasks, but usually takes longer.',
              })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
