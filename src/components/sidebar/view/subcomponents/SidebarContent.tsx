import type { TFunction } from 'i18next';
import { ScrollArea } from '../../../../shared/view/ui';
import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  onShowSettings: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  onShowSettings,
  projectListProps,
  t,
}: SidebarContentProps) {
  return (
    <div
      className="flex h-full flex-col border-r border-white/5 bg-background md:w-72 md:select-none relative z-10"
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      <ScrollArea className="flex-1 overflow-y-auto overscroll-contain md:px-1.5 md:py-2">
        <SidebarProjectList {...projectListProps} />
      </ScrollArea>

      <SidebarFooter
        onShowSettings={onShowSettings}
        t={t}
      />
    </div>
  );
}