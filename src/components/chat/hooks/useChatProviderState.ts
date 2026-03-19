import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { CLAUDE_MODELS, CODEX_MODELS, CURSOR_MODELS, GEMINI_MODELS } from '../../../../shared/modelConstants';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type { ProjectSession, SessionProvider } from '../../../types/app';
import { safeLocalStorage } from '../utils/chatStorage';
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  isCodexReasoningEffort,
  type CodexReasoningEffort,
} from '../constants/codexReasoningEfforts';

const CODEX_SETTINGS_KEY = 'codex-settings';
const DEFAULT_CODEX_PERMISSION_MODE = 'plan';

const isCodexPermissionMode = (value: unknown): value is 'acceptEdits' | 'plan' =>
  value === 'acceptEdits' || value === 'plan';

const getStoredProvider = (): SessionProvider =>
  (safeLocalStorage.getItem('selected-provider') as SessionProvider) || 'claude';

const readStoredCodexSettings = (): { permissionMode?: unknown; reasoningEffort?: unknown } => {
  const savedSettings = safeLocalStorage.getItem(CODEX_SETTINGS_KEY);
  if (!savedSettings) {
    return {};
  }

  try {
    const parsed = JSON.parse(savedSettings) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const getDefaultCodexPermissionMode = (): 'acceptEdits' | 'plan' => {
  const parsed = readStoredCodexSettings();
  return isCodexPermissionMode(parsed.permissionMode) ? parsed.permissionMode : DEFAULT_CODEX_PERMISSION_MODE;
};

const getDefaultCodexReasoningEffort = (): CodexReasoningEffort => {
  const parsed = readStoredCodexSettings();
  return isCodexReasoningEffort(parsed.reasoningEffort) ? parsed.reasoningEffort : DEFAULT_CODEX_REASONING_EFFORT;
};

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [provider, setProvider] = useState<SessionProvider>(getStoredProvider);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => (
    getStoredProvider() === 'codex' ? getDefaultCodexPermissionMode() : 'default'
  ));
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<CodexReasoningEffort>(getDefaultCodexReasoningEffort);
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [cursorModel, setCursorModel] = useState<string>(() => {
    return localStorage.getItem('cursor-model') || CURSOR_MODELS.DEFAULT;
  });
  const [claudeModel, setClaudeModel] = useState<string>(() => {
    return localStorage.getItem('claude-model') || CLAUDE_MODELS.DEFAULT;
  });
  const [codexModel, setCodexModel] = useState<string>(() => {
    return localStorage.getItem('codex-model') || CODEX_MODELS.DEFAULT;
  });
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    return localStorage.getItem('gemini-model') || GEMINI_MODELS.DEFAULT;
  });

  const lastProviderRef = useRef(provider);
  const hasPersistedCodexReasoningRef = useRef(false);

  useEffect(() => {
    if (!selectedSession?.id) {
      if (provider === 'codex') {
        setPermissionMode(getDefaultCodexPermissionMode());
      }
      return;
    }

    const savedMode = localStorage.getItem('permissionMode-' + selectedSession.id);
    if (provider === 'codex') {
      setPermissionMode(isCodexPermissionMode(savedMode) ? savedMode : getDefaultCodexPermissionMode());
    } else {
      setPermissionMode((savedMode as PermissionMode) || 'default');
    }
  }, [selectedSession?.id, provider]);

  // When provider changes to codex, ensure valid mode
  useEffect(() => {
    if (provider !== 'codex') {
      return;
    }
    if (!isCodexPermissionMode(permissionMode)) {
      setPermissionMode(getDefaultCodexPermissionMode());
    }
  }, [permissionMode, provider]);

  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === provider) {
      return;
    }

    setProvider(selectedSession.__provider);
    localStorage.setItem('selected-provider', selectedSession.__provider);
  }, [provider, selectedSession]);

  useEffect(() => {
    if (lastProviderRef.current === provider) {
      return;
    }
    setPendingPermissionRequests([]);
    lastProviderRef.current = provider;
  }, [provider]);

  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  useEffect(() => {
    if (provider !== 'cursor') {
      return;
    }

    authenticatedFetch('/api/cursor/config')
      .then((response) => response.json())
      .then((data) => {
        if (!data.success || !data.config?.model?.modelId) {
          return;
        }

        const modelId = data.config.model.modelId as string;
        if (!localStorage.getItem('cursor-model')) {
          setCursorModel(modelId);
        }
      })
      .catch((error) => {
        console.error('Error loading Cursor config:', error);
      });
  }, [provider]);

  useEffect(() => {
    if (!hasPersistedCodexReasoningRef.current) {
      hasPersistedCodexReasoningRef.current = true;
      return;
    }

    const existingSettings = readStoredCodexSettings();
    safeLocalStorage.setItem(CODEX_SETTINGS_KEY, JSON.stringify({
      ...existingSettings,
      reasoningEffort: codexReasoningEffort,
      lastUpdated: new Date().toISOString(),
    }));
  }, [codexReasoningEffort]);

  const cyclePermissionMode = useCallback(() => {
    const modes: PermissionMode[] =
      provider === 'codex'
        ? ['acceptEdits', 'plan']
        : ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setPermissionMode(nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [permissionMode, provider, selectedSession?.id]);

  return {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    codexReasoningEffort,
    setCodexReasoningEffort,
    geminiModel,
    setGeminiModel,
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  };
}
