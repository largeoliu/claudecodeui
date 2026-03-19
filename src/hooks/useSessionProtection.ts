import { useCallback, useState } from 'react';

export function useSessionProtection() {
  const [activeSessions, setActiveSessions] = useState<Set<string>>(new Set());
  const [processingSessions, setProcessingSessions] = useState<Set<string>>(new Set());

  const preserveTemporarySessions = useCallback((prev: Set<string>, next: Set<string>) => {
    for (const sessionId of prev) {
      if (sessionId.startsWith('new-session-')) {
        next.add(sessionId);
      }
    }
    return next;
  }, []);

  const markSessionAsActive = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    setActiveSessions((prev) => new Set([...prev, sessionId]));
  }, []);

  const markSessionAsInactive = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    setActiveSessions((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const markSessionAsProcessing = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    setProcessingSessions((prev) => new Set([...prev, sessionId]));
  }, []);

  const markSessionAsNotProcessing = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    setProcessingSessions((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const replaceTemporarySession = useCallback((realSessionId?: string | null) => {
    if (!realSessionId) {
      return;
    }

    setActiveSessions((prev) => {
      const next = new Set<string>();
      for (const sessionId of prev) {
        if (!sessionId.startsWith('new-session-')) {
          next.add(sessionId);
        }
      }
      next.add(realSessionId);
      return next;
    });

    setProcessingSessions((prev) => {
      const next = new Set<string>();
      for (const sessionId of prev) {
        if (!sessionId.startsWith('new-session-')) {
          next.add(sessionId);
        }
      }
      next.add(realSessionId);
      return next;
    });
  }, []);

  const syncSessionsFromServer = useCallback((sessionIds: Iterable<string>) => {
    const normalized = new Set(
      Array.from(sessionIds).filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
    );

    setActiveSessions((prev) => preserveTemporarySessions(prev, new Set(normalized)));
    setProcessingSessions((prev) => preserveTemporarySessions(prev, new Set(normalized)));
  }, [preserveTemporarySessions]);

  return {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
    syncSessionsFromServer,
  };
}
