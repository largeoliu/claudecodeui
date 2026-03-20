import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

/* ── Container ─────────────────────────────────────────────────── */
type PillBarProps = {
  children: ReactNode;
  className?: string;
};

export function PillBar({ children, className }: PillBarProps) {
  return (
    <div className={cn('inline-flex items-center gap-[4px] rounded-xl bg-white/[0.03] p-[3px] border border-white/5 backdrop-blur-md', className)}>
      {children}
    </div>
  );
}

/* ── Individual pill button ────────────────────────────────────── */
type PillProps = {
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
};

export function Pill({ isActive, onClick, children, className }: PillProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex touch-manipulation items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition-all duration-300',
        isActive
          ? 'bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.05)] ring-1 ring-white/20'
          : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04] active:scale-95',
        className,
      )}
    >
      {children}
    </button>
  );
}
