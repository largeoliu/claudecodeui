import React, { useMemo, useState } from 'react';
import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';
import { isInteractiveRequestInFlight } from '../../../utils/interactiveRequestTransport';

export const CodexTerminalInputPanel: React.FC<PermissionPanelProps> = ({
  request,
  onDecision,
}) => {
  const input = request.input as {
    prompt?: string;
    observedStdin?: string;
    processId?: string;
  } | undefined;

  const [text, setText] = useState('');
  const prompt = useMemo(
    () => (typeof input?.prompt === 'string' && input.prompt.trim() ? input.prompt : 'Terminal input required'),
    [input?.prompt],
  );
  const isSubmitting = isInteractiveRequestInFlight(request.deliveryState);
  const deliveryError = request.deliveryState === 'failed' ? request.deliveryError : null;

  const handleSubmit = () => {
    if (isSubmitting) {
      return;
    }
    onDecision(request.requestId, {
      allow: true,
      updatedInput: { text },
    });
  };

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 shadow-sm dark:border-sky-800 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-sky-900 dark:text-sky-100">Terminal input required</div>
          <div className="text-xs text-sky-800 dark:text-sky-200">{prompt}</div>
        </div>
        {input?.processId && (
          <div className="text-xs text-sky-700 dark:text-sky-300">
            Process: <span className="font-mono">{input.processId}</span>
          </div>
        )}
      </div>

      {deliveryError ? (
        <div className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{deliveryError}</div>
      ) : null}
      {isSubmitting ? (
        <div className="mt-2 text-xs font-medium text-sky-700 dark:text-sky-300">Submitting...</div>
      ) : null}

      {input?.observedStdin ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-sky-800 hover:text-sky-900 dark:text-sky-200 dark:hover:text-sky-100">
            View current stdin
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-sky-200/60 bg-white/80 p-2 text-xs text-sky-900 dark:border-sky-800/60 dark:bg-gray-900/60 dark:text-sky-100">
            {input.observedStdin}
          </pre>
        </details>
      ) : null}

      <textarea
        value={text}
        disabled={isSubmitting}
        onChange={(event) => setText(event.target.value)}
        placeholder="Type the text to send to the terminal"
        className="mt-3 min-h-24 w-full rounded-md border border-sky-200 bg-white px-3 py-2 text-sm text-sky-950 outline-none ring-0 placeholder:text-sky-400 focus:border-sky-400 dark:border-sky-800 dark:bg-gray-950 dark:text-sky-100 dark:placeholder:text-sky-500"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700"
        >
          {request.deliveryState === 'failed' ? 'Retry send input' : 'Send input'}
        </button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => onDecision(request.requestId, { allow: true, updatedInput: { text: '' } })}
          className="inline-flex items-center gap-2 rounded-md border border-sky-300 px-3 py-1.5 text-xs font-medium text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-700 dark:text-sky-100 dark:hover:bg-sky-900/30"
        >
          Send empty line
        </button>
      </div>
    </div>
  );
};
