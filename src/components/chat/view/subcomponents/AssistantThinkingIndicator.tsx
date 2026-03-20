import { useTranslation } from 'react-i18next';

type AssistantThinkingIndicatorProps = {
  selectedProvider: unknown;
}


export default function AssistantThinkingIndicator({ selectedProvider: _selectedProvider }: AssistantThinkingIndicatorProps) {
  const { t } = useTranslation('chat');
  return (
    <div className="chat-message assistant px-3 sm:px-0">
      <style>{`
        @keyframes thinking-wave {
          0%, 60%, 100% { transform: scaleY(0.6); opacity: 0.5; }
          30% { transform: scaleY(1.2); opacity: 1; }
        }
        .animate-thinking-wave {
          animation: thinking-wave 1s infinite ease-in-out;
          transform-origin: center;
        }
        @keyframes thinking-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .animate-thinking-pulse {
          animation: thinking-pulse 2s infinite ease-in-out;
        }
      `}</style>
      <div className="w-full pl-0 text-sm">
        <div className="flex items-center space-x-3 py-3 px-2 bg-primary/5 rounded-lg border border-primary/10 w-fit">
          <div className="flex items-center space-x-1.5 h-4">
            <div className="w-1 h-3 bg-primary rounded-full animate-thinking-wave" style={{ animationDelay: '0s' }}></div>
            <div className="w-1 h-3 bg-primary rounded-full animate-thinking-wave" style={{ animationDelay: '0.15s' }}></div>
            <div className="w-1 h-3 bg-primary rounded-full animate-thinking-wave" style={{ animationDelay: '0.3s' }}></div>
          </div>
          <span className="animate-thinking-pulse font-semibold text-primary/90 tracking-wider">
            {t('thinking.title', { defaultValue: '思考中...' })}
          </span>
        </div>
      </div>
    </div>
  );
}
