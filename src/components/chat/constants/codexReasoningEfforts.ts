export const DEFAULT_CODEX_REASONING_EFFORT = 'medium';

export const CODEX_REASONING_EFFORTS = [
  {
    id: 'low',
    color: 'text-emerald-600',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  },
  {
    id: 'medium',
    color: 'text-sky-600',
    badge: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300',
  },
  {
    id: 'high',
    color: 'text-violet-600',
    badge: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300',
  },
  {
    id: 'xhigh',
    color: 'text-rose-600',
    badge: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
  },
] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number]['id'];

export const isCodexReasoningEffort = (value: unknown): value is CodexReasoningEffort => (
  CODEX_REASONING_EFFORTS.some((effort) => effort.id === value)
);
