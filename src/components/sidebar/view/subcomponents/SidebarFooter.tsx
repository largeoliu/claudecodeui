import { Settings, ArrowUpCircle } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ReleaseInfo } from '../../../../types/sharedTypes';

type SidebarFooterProps = {
  updateAvailable: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  t: TFunction;
};

export default function SidebarFooter({
  updateAvailable,
  releaseInfo,
  latestVersion,
  onShowVersionModal,
  onShowSettings,
  t,
}: SidebarFooterProps) {
  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Update banner */}
      {updateAvailable && (
        <>
          <div className="nav-divider" />
          {/* Desktop update */}
          <div className="hidden px-2 py-1.5 md:block">
            <button
              className="group flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left transition-all hover:bg-white/10 active:scale-[0.98]"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <ArrowUpCircle className="h-4.5 w-4.5 text-white/50 group-hover:text-white transition-colors" />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-white/80 animate-pulse shadow-[0_0_6px_rgba(255,255,255,0.4)]" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-white">
                  {releaseInfo?.title || `v${latestVersion}`}
                </span>
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-medium">
                  {t('version.updateAvailable')}
                </span>
              </div>
            </button>
          </div>

          {/* Mobile update */}
          <div className="px-3 py-2 md:hidden">
            <button
              className="flex h-12 w-full items-center gap-3.5 rounded-lg border border-white/10 bg-white/5 px-4 transition-all active:scale-[0.98]"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <ArrowUpCircle className="w-5 h-5 text-white" />
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-white/80 animate-pulse" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-semibold text-white">
                  {releaseInfo?.title || `v${latestVersion}`}
                </span>
                <span className="text-xs text-white/50">
                  {t('version.updateAvailable')}
                </span>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Settings */}
      <div className="nav-divider" />

      {/* Desktop settings */}
      <div className="hidden px-2 py-1.5 md:block">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onShowSettings}
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="text-sm">{t('actions.settings')}</span>
        </button>
      </div>

      {/* Mobile settings */}
      <div className="px-3 pb-20 pt-2 md:hidden">
        <button
          className="flex h-12 w-full items-center gap-3.5 rounded-lg bg-muted/40 px-4 transition-all hover:bg-muted/60 active:scale-[0.98]"
          onClick={onShowSettings}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background/80">
            <Settings className="w-4.5 h-4.5 text-muted-foreground" />
          </div>
          <span className="text-base font-medium text-foreground">{t('actions.settings')}</span>
        </button>
      </div>
    </div>
  );
}
