import { useTranslation } from 'react-i18next';

type AssistantThinkingIndicatorProps = {
  selectedProvider: unknown;
}


export default function AssistantThinkingIndicator({ selectedProvider: _selectedProvider }: AssistantThinkingIndicatorProps) {
  const { t } = useTranslation('chat');
  return (
    <div className="chat-message assistant px-3 sm:px-0">
      <div className="w-full pl-0 text-sm text-gray-500 dark:text-gray-400">
        <div className="flex items-center space-x-1">
          <div className="animate-pulse">.</div>
          <div className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</div>
          <div className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</div>
          <span className="ml-2">{t('thinking.title', { defaultValue: '思考中...' })}</span>
        </div>
      </div>
    </div>
  );
}
