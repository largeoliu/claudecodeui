import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import { useWebSocket, useWebSocketMessageEffect } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';

type ActiveSessionsMessage = {
  type?: 'active-sessions';
  sessions?: {
    claude?: string[];
    cursor?: string[];
    codex?: string[];
    gemini?: string[];
    [key: string]: unknown;
  };
};

export default function AppContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, isConnected } = useWebSocket();
  const wasConnectedRef = useRef(false);

  const {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
    syncSessionsFromServer,
  } = useSessionProtection();

  const {
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    isInputFocused,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    refreshProjectsSilently,
    sidebarSharedProps,
  } = useProjectsState({
    sessionId,
    navigate,
    isMobile,
    activeSessions,
  });

  useEffect(() => {
    // Expose a non-blocking refresh for chat/session flows.
    // Full loading refreshes are still available through direct fetchProjects calls.
    window.refreshProjects = refreshProjectsSilently;

    return () => {
      if (window.refreshProjects === refreshProjectsSilently) {
        delete window.refreshProjects;
      }
    };
  }, [refreshProjectsSilently]);

  useEffect(() => {
    window.openSettings = openSettings;

    return () => {
      if (window.openSettings === openSettings) {
        delete window.openSettings;
      }
    };
  }, [openSettings]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') {
        return;
      }

      if (typeof message.provider === 'string' && message.provider.trim()) {
        localStorage.setItem('selected-provider', message.provider);
      }

      setActiveTab('chat');
      setSidebarOpen(false);
      void refreshProjectsSilently();

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }

      navigate('/');
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab, setSidebarOpen]);

  useEffect(() => {
    if (!isConnected) {
      wasConnectedRef.current = false;
      return;
    }

    wasConnectedRef.current = true;
    sendMessage({ type: 'get-active-sessions' });
  }, [isConnected, sendMessage]);

  useWebSocketMessageEffect<ActiveSessionsMessage>(
    (message) => {
      const activeSessionsData = message.sessions;
      if (!activeSessionsData) {
        return;
      }

      const allActiveIds = [
        ...(Array.isArray(activeSessionsData.claude) ? activeSessionsData.claude : []),
        ...(Array.isArray(activeSessionsData.cursor) ? activeSessionsData.cursor : []),
        ...(Array.isArray(activeSessionsData.codex) ? activeSessionsData.codex : []),
        ...(Array.isArray(activeSessionsData.gemini) ? activeSessionsData.gemini : []),
      ];

      syncSessionsFromServer(allActiveIds);
    },
    (message) => message.type === 'active-sessions',
  );

  return (
    <div className="fixed inset-0 flex bg-background">
      {!isMobile ? (
        <div className="h-full flex-shrink-0 border-r border-white/[0.04] nav-glass relative z-20">
          <Sidebar {...sidebarSharedProps} processingSessions={processingSessions} />
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
        >
          <button
            className="fixed inset-0 bg-black/40 backdrop-blur-md transition-opacity duration-300 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative h-full w-[85vw] max-w-sm transform border-r border-white/10 bg-background transition-transform duration-150 ease-out sm:w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} processingSessions={processingSessions} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <MainContent
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionActive={markSessionAsActive}
          onSessionInactive={markSessionAsInactive}
          onSessionProcessing={markSessionAsProcessing}
          onSessionNotProcessing={markSessionAsNotProcessing}
          processingSessions={processingSessions}
          onReplaceTemporarySession={replaceTemporarySession}
          onNavigateToSession={(targetSessionId: string) => navigate(`/session/${targetSessionId}`)}
          onShowSettings={() => setShowSettings(true)}
          externalMessageUpdate={externalMessageUpdate}
        />
      </div>

    </div>
  );
}
