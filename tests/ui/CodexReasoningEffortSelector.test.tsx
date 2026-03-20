// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import CodexReasoningEffortSelector from '../../src/components/chat/view/subcomponents/CodexReasoningEffortSelector';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('CodexReasoningEffortSelector', () => {
  it('filters out unsupported efforts for the selected model', () => {
    const onEffortChange = vi.fn();
    render(
      <CodexReasoningEffortSelector
        model="o4-mini"
        selectedEffort="medium"
        onEffortChange={onEffortChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /medium/i }));

    expect(screen.getByRole('button', { name: 'low' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'medium' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'high' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'xhigh' })).not.toBeInTheDocument();
  });

  it('shows xhigh for models that support it', () => {
    render(
      <CodexReasoningEffortSelector
        model="gpt-5.2"
        selectedEffort="xhigh"
        onEffortChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /xhigh/i }));

    expect(screen.getByRole('button', { name: 'low' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'high' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'xhigh' })).toHaveLength(2);
  });

  it('coerces the displayed selection when the stored effort is unsupported', () => {
    render(
      <CodexReasoningEffortSelector
        model="o3"
        selectedEffort="xhigh"
        onEffortChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /high/i })).toBeInTheDocument();
  });
});
