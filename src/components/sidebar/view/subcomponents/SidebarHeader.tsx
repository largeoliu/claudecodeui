import { FolderPlus, Plus, RefreshCw, PanelLeftClose } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../../shared/view/ui';
import { IS_PLATFORM } from '../../../../constants/config';
import { cn } from '../../../../lib/utils';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const LogoBlock = () => (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.15)] transition-transform hover:scale-105 active:scale-95">
        <svg className="h-4 w-4 text-zinc-950" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 19h20L12 2zm0 3.8L19.1 17H4.9L12 5.8z" opacity=".2" />
          <path d="M12 8l-5 8h10l-5-8z" />
        </svg>
      </div>
      <div className="flex flex-col min-w-0">
        <h1 className="truncate text-[13px] font-bold tracking-tight text-white leading-tight">{t('app.title')}</h1>
        <span className="text-[9px] uppercase tracking-[0.2em] text-white/30 font-bold whitespace-nowrap">Absolute Neutral</span>
      </div>
    </div>
  );

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden px-3 pb-2 pt-3 md:block"
      >
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex flex-shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-lg p-0 text-white/30 hover:bg-white/5 hover:text-white"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-lg p-0 text-white/30 hover:bg-white/5 hover:text-white"
              onClick={onCreateProject}
              title={t('tooltips.createProject')}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-lg p-0 text-white/30 hover:bg-white/5 hover:text-white"
              onClick={onCollapseSidebar}
              title={t('tooltips.hideSidebar')}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Desktop divider */}
      <div className="nav-divider hidden md:block" />

      {/* Mobile header */}
      <div
        className="p-3 pb-2 md:hidden"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity active:opacity-70"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex flex-shrink-0 gap-1.5">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 transition-all active:scale-95"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground transition-all active:scale-95"
              onClick={onCreateProject}
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
