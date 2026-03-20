import { useCallback, useRef, useState, useEffect } from 'react';
import type { MainContentHeaderProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';
import MainContentTabSwitcher from './MainContentTabSwitcher';
import MainContentTitle from './MainContentTitle';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  processingSessions,
  shouldShowTasksTab,
  isMobile,
  onMenuClick,
}: MainContentHeaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollState]);

  return (
    <header className="sticky top-0 z-30 flex h-12 w-full flex-shrink-0 items-center justify-between border-b border-white/[0.04] nav-glass px-4 transition-all duration-300">
      <div className="flex items-center gap-3">
        {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
        <MainContentTitle
          activeTab={activeTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          processingSessions={processingSessions}
          shouldShowTasksTab={shouldShowTasksTab}
        />
      </div>

      <div className="relative min-w-0 flex-shrink overflow-hidden sm:flex-shrink-0">
        {canScrollLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent" />
        )}
        <div
          ref={scrollRef}
          onScroll={updateScrollState}
          className="scrollbar-hide overflow-x-auto"
        >
          <MainContentTabSwitcher
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            shouldShowTasksTab={shouldShowTasksTab}
          />
        </div>
        {canScrollRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent" />
        )}
      </div>
    </header>
  );
}
