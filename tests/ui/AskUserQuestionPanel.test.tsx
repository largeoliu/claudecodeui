// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { AskUserQuestionPanel } from '../../src/components/chat/tools/components/InteractiveRenderers';

describe('AskUserQuestionPanel', () => {
  it('submits multi-select answers as arrays', () => {
    const onDecision = vi.fn();

    render(
      <AskUserQuestionPanel
        request={{
          requestId: 'req-1',
          provider: 'codex',
          requestKind: 'user-input',
          toolName: 'AskUserQuestion',
          input: {
            questions: [
              {
                id: 'settings',
                question: 'Which settings should be session-scoped?',
                multiSelect: true,
                options: [
                  { label: 'Model' },
                  { label: 'Approval policy' },
                ],
              },
            ],
          },
        }}
        onDecision={onDecision}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Model/i }));
    fireEvent.click(screen.getByRole('button', { name: /Approval policy/i }));
    fireEvent.click(screen.getByRole('button', { name: /Submit/i }));

    expect(onDecision).toHaveBeenCalledWith('req-1', {
      allow: true,
      updatedInput: {
        questions: [
          {
            id: 'settings',
            question: 'Which settings should be session-scoped?',
            multiSelect: true,
            options: [
              { label: 'Model' },
              { label: 'Approval policy' },
            ],
          },
        ],
        answers: {
          settings: ['Model', 'Approval policy'],
        },
      },
    });
  });

  it('shows retry state after a delivery failure', () => {
    render(
      <AskUserQuestionPanel
        request={{
          requestId: 'req-2',
          provider: 'codex',
          requestKind: 'user-input',
          toolName: 'AskUserQuestion',
          deliveryState: 'failed',
          deliveryError: 'Response was not delivered. Reconnect and try again.',
          input: {
            questions: [
              {
                id: 'scope',
                question: 'How should the model selection be remembered?',
                options: [{ label: 'Per session' }],
              },
            ],
          },
        }}
        onDecision={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Per session/i }));

    expect(screen.getByText('Response was not delivered. Reconnect and try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry submit/i })).toBeEnabled();
  });
});
