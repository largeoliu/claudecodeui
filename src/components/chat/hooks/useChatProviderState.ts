import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  GEMINI_MODELS,
  coerceCodexReasoningEffortForModel,
} from '../../../../shared/modelConstants';
import type {
  CodexApprovalPolicy,
  CodexInteractionMode,
  PendingPermissionRequest,
  PermissionMode,
} from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import { safeLocalStorage } from '../utils/chatStorage';
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  isCodexReasoningEffort,
  type CodexReasoningEffort,
} from '../constants/codexReasoningEfforts';

const CODEX_SETTINGS_KEY = 'codex-settings';
const DEFAULT_CODEX_INTERACTION_MODE: CodexInteractionMode = 'edit';
const DEFAULT_CODEX_APPROVAL_POLICY: CodexApprovalPolicy = 'on-request';
const CODEX_INTERACTION_MODE_PREFIX = 'codex-interaction-mode-';
const CODEX_APPROVAL_POLICY_PREFIX = 'codex-approval-policy-';
const CODEX_SESSION_SETTINGS_PREFIX = 'chat-session-settings:codex:';
const CODEX_DRAFT_SETTINGS_PREFIX = 'chat-draft-settings:';

type CodexSettingsState = {
  model: string;
  interactionMode: CodexInteractionMode;
  approvalPolicy: CodexApprovalPolicy;
  reasoningEffort: CodexReasoningEffort;
};

const isCodexInteractionMode = (value: unknown): value is CodexInteractionMode => (
  value === 'edit' || value === 'plan'
);

const isCodexApprovalPolicy = (value: unknown): value is CodexApprovalPolicy => (
  value === 'untrusted' || value === 'on-request' || value === 'never'
);

const isSessionProvider = (value: unknown): value is SessionProvider => (
  value === 'claude' || value === 'codex' || value === 'gemini'
);

const getStoredProvider = (): SessionProvider => {
  const storedProvider = safeLocalStorage.getItem('selected-provider');
  return isSessionProvider(storedProvider) ? storedProvider : 'claude';
};

const readStoredCodexSettings = (): {
  interactionMode?: unknown;
  approvalPolicy?: unknown;
  reasoningEffort?: unknown;
} => {
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

const getDefaultCodexInteractionMode = (): CodexInteractionMode => {
  const parsed = readStoredCodexSettings();
  return isCodexInteractionMode(parsed.interactionMode)
    ? parsed.interactionMode
    : DEFAULT_CODEX_INTERACTION_MODE;
};

const getDefaultCodexApprovalPolicy = (): CodexApprovalPolicy => {
  const parsed = readStoredCodexSettings();
  return isCodexApprovalPolicy(parsed.approvalPolicy)
    ? parsed.approvalPolicy
    : DEFAULT_CODEX_APPROVAL_POLICY;
};

const getDefaultCodexReasoningEffort = (): CodexReasoningEffort => {
  const parsed = readStoredCodexSettings();
  const model = safeLocalStorage.getItem('codex-model') || CODEX_MODELS.DEFAULT;
  return coerceCodexReasoningEffortForModel(
    model,
    isCodexReasoningEffort(parsed.reasoningEffort)
      ? parsed.reasoningEffort
      : DEFAULT_CODEX_REASONING_EFFORT,
  ) as CodexReasoningEffort;
};

const resolveCodexReasoningEffort = (
  model: string,
  reasoningEffort: unknown,
  fallback: CodexReasoningEffort = DEFAULT_CODEX_REASONING_EFFORT,
): CodexReasoningEffort => (
  coerceCodexReasoningEffortForModel(
    model,
    isCodexReasoningEffort(reasoningEffort) ? reasoningEffort : fallback,
  ) as CodexReasoningEffort
);

const isConcreteSessionId = (value: string | null | undefined): value is string => (
  typeof value === 'string' && value.length > 0 && !value.startsWith('new-session-')
);

const getProjectKey = (selectedProject: Project | null): string | null => (
  selectedProject?.fullPath || selectedProject?.path || selectedProject?.name || null
);

const getCodexSessionSettingsKey = (sessionId: string) => `${CODEX_SESSION_SETTINGS_PREFIX}${sessionId}`;

const getCodexDraftSettingsKey = (projectKey: string) => `${CODEX_DRAFT_SETTINGS_PREFIX}${projectKey}:codex`;

const readJsonStorage = (key: string): Record<string, unknown> | null => {
  const raw = safeLocalStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const writeJsonStorage = (key: string, value: Record<string, unknown>) => {
  safeLocalStorage.setItem(key, JSON.stringify({
    ...value,
    lastUpdated: new Date().toISOString(),
  }));
};

const readLegacyCodexSettings = (sessionId?: string | null): CodexSettingsState => {
  const globalSettings = readStoredCodexSettings();
  const model = safeLocalStorage.getItem('codex-model') || CODEX_MODELS.DEFAULT;
  const savedInteractionMode = isConcreteSessionId(sessionId)
    ? safeLocalStorage.getItem(`${CODEX_INTERACTION_MODE_PREFIX}${sessionId}`)
    : null;
  const savedApprovalPolicy = isConcreteSessionId(sessionId)
    ? safeLocalStorage.getItem(`${CODEX_APPROVAL_POLICY_PREFIX}${sessionId}`)
    : null;

  return {
    model,
    interactionMode: isCodexInteractionMode(savedInteractionMode)
      ? savedInteractionMode
      : getDefaultCodexInteractionMode(),
    approvalPolicy: isCodexApprovalPolicy(savedApprovalPolicy)
      ? savedApprovalPolicy
      : getDefaultCodexApprovalPolicy(),
    reasoningEffort: resolveCodexReasoningEffort(model, globalSettings.reasoningEffort),
  };
};

const normalizeCodexSettings = (
  settings: Record<string, unknown> | null,
  fallback: CodexSettingsState,
): CodexSettingsState => {
  const model =
    typeof settings?.model === 'string' && settings.model.trim()
      ? settings.model
      : fallback.model;

  return {
    model,
    interactionMode: isCodexInteractionMode(settings?.interactionMode)
      ? settings.interactionMode
      : fallback.interactionMode,
    approvalPolicy: isCodexApprovalPolicy(settings?.approvalPolicy)
      ? settings.approvalPolicy
      : fallback.approvalPolicy,
    reasoningEffort: resolveCodexReasoningEffort(model, settings?.reasoningEffort, fallback.reasoningEffort),
  };
};

const getPendingSessionId = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const pendingSessionId = sessionStorage.getItem('pendingSessionId');
  return isConcreteSessionId(pendingSessionId) ? pendingSessionId : null;
};

const resolveActiveCodexSessionId = ({
  provider,
  selectedSession,
  currentSessionId,
}: {
  provider: SessionProvider;
  selectedSession: ProjectSession | null;
  currentSessionId?: string | null;
}): string | null => {
  if (selectedSession?.__provider === 'codex' && isConcreteSessionId(selectedSession.id)) {
    return selectedSession.id;
  }

  if (provider !== 'codex') {
    return null;
  }

  if (isConcreteSessionId(currentSessionId)) {
    return currentSessionId;
  }

  return getPendingSessionId();
};

interface UseChatProviderStateArgs {
  selectedProject?: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId?: string | null;
}

export function useChatProviderState({
  selectedProject = null,
  selectedSession,
  currentSessionId = null,
}: UseChatProviderStateArgs) {
  const [provider, setProvider] = useState<SessionProvider>(getStoredProvider);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [claudeModel, setClaudeModel] = useState<string>(() => (
    safeLocalStorage.getItem('claude-model') || CLAUDE_MODELS.DEFAULT
  ));
  const [geminiModel, setGeminiModel] = useState<string>(() => (
    safeLocalStorage.getItem('gemini-model') || GEMINI_MODELS.DEFAULT
  ));
  const [codexModel, setCodexModelState] = useState<string>(() => (
    safeLocalStorage.getItem('codex-model') || CODEX_MODELS.DEFAULT
  ));
  const [codexInteractionMode, setCodexInteractionModeState] = useState<CodexInteractionMode>(getDefaultCodexInteractionMode);
  const [codexApprovalPolicy, setCodexApprovalPolicyState] = useState<CodexApprovalPolicy>(getDefaultCodexApprovalPolicy);
  const [codexReasoningEffort, setCodexReasoningEffortState] = useState<CodexReasoningEffort>(getDefaultCodexReasoningEffort);

  const lastProviderRef = useRef(provider);
  const projectKey = useMemo(() => getProjectKey(selectedProject), [selectedProject]);

  const applyCodexSettings = useCallback((settings: CodexSettingsState) => {
    setCodexModelState(settings.model);
    setCodexInteractionModeState(settings.interactionMode);
    setCodexApprovalPolicyState(settings.approvalPolicy);
    setCodexReasoningEffortState(settings.reasoningEffort);
  }, []);

  const readCurrentCodexSettings = useCallback((): CodexSettingsState => {
    const resolvedSessionId = resolveActiveCodexSessionId({
      provider,
      selectedSession,
      currentSessionId,
    });

    if (resolvedSessionId) {
      return normalizeCodexSettings(
        readJsonStorage(getCodexSessionSettingsKey(resolvedSessionId)),
        readLegacyCodexSettings(resolvedSessionId),
      );
    }

    if (provider === 'codex' && projectKey) {
      return normalizeCodexSettings(
        readJsonStorage(getCodexDraftSettingsKey(projectKey)),
        readLegacyCodexSettings(null),
      );
    }

    return readLegacyCodexSettings(null);
  }, [currentSessionId, projectKey, provider, selectedSession]);

  const persistCodexSettings = useCallback((partial: Partial<CodexSettingsState>) => {
    const resolvedSessionId = resolveActiveCodexSessionId({
      provider,
      selectedSession,
      currentSessionId,
    });

    const normalizedSettings = normalizeCodexSettings({
      ...readCurrentCodexSettings(),
      ...partial,
    }, readCurrentCodexSettings());

    if (resolvedSessionId) {
      const sessionKey = getCodexSessionSettingsKey(resolvedSessionId);
      writeJsonStorage(sessionKey, normalizedSettings);
      applyCodexSettings(normalizedSettings);
      return;
    }

    if (provider === 'codex' && projectKey) {
      const draftKey = getCodexDraftSettingsKey(projectKey);
      writeJsonStorage(draftKey, normalizedSettings);
      applyCodexSettings(normalizedSettings);
      return;
    }

    applyCodexSettings(normalizedSettings);
  }, [applyCodexSettings, currentSessionId, projectKey, provider, readCurrentCodexSettings, selectedSession]);

  const handleCodexSessionCreated = useCallback((sessionId?: string | null) => {
    if (!isConcreteSessionId(sessionId)) {
      return;
    }

    const legacyFallback = readLegacyCodexSettings(sessionId);
    let nextSettings = normalizeCodexSettings(
      readJsonStorage(getCodexSessionSettingsKey(sessionId)),
      legacyFallback,
    );

    if (projectKey) {
      const draftKey = getCodexDraftSettingsKey(projectKey);
      const draftSettings = readJsonStorage(draftKey);
      if (draftSettings) {
        nextSettings = normalizeCodexSettings(draftSettings, legacyFallback);
        writeJsonStorage(getCodexSessionSettingsKey(sessionId), nextSettings);
        safeLocalStorage.removeItem(draftKey);
      }
    }

    if (provider === 'codex') {
      applyCodexSettings(nextSettings);
    }
  }, [applyCodexSettings, projectKey, provider]);

  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === provider) {
      return;
    }

    setProvider(selectedSession.__provider);
    safeLocalStorage.setItem('selected-provider', selectedSession.__provider);
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
    const shouldUseCodexSettings = provider === 'codex' || selectedSession?.__provider === 'codex';
    if (shouldUseCodexSettings) {
      applyCodexSettings(readCurrentCodexSettings());
      return;
    }

    if (!selectedSession?.id) {
      return;
    }

    const savedMode = safeLocalStorage.getItem(`permissionMode-${selectedSession.id}`);
    setPermissionMode((savedMode as PermissionMode) || 'default');
  }, [applyCodexSettings, currentSessionId, provider, readCurrentCodexSettings, selectedSession?.__provider, selectedSession?.id]);

  const setCodexModel = useCallback((nextModel: string) => {
    persistCodexSettings({
      model: nextModel,
      reasoningEffort: coerceCodexReasoningEffortForModel(nextModel, codexReasoningEffort) as CodexReasoningEffort,
    });
  }, [codexReasoningEffort, persistCodexSettings]);

  const setCodexInteractionMode = useCallback((nextMode: CodexInteractionMode) => {
    persistCodexSettings({ interactionMode: nextMode });
  }, [persistCodexSettings]);

  const setCodexApprovalPolicy = useCallback((nextPolicy: CodexApprovalPolicy) => {
    persistCodexSettings({ approvalPolicy: nextPolicy });
  }, [persistCodexSettings]);

  const setCodexReasoningEffort = useCallback((nextEffort: CodexReasoningEffort) => {
    persistCodexSettings({
      reasoningEffort: coerceCodexReasoningEffortForModel(codexModel, nextEffort) as CodexReasoningEffort,
    });
  }, [codexModel, persistCodexSettings]);

  const cyclePermissionMode = useCallback(() => {
    if (provider === 'codex') {
      const modes: CodexInteractionMode[] = ['edit', 'plan'];
      const currentIndex = modes.indexOf(codexInteractionMode);
      const nextMode = modes[(currentIndex + 1) % modes.length];
      setCodexInteractionMode(nextMode);
      return;
    }

    const modes: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
    const currentIndex = modes.indexOf(permissionMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setPermissionMode(nextMode);

    if (selectedSession?.id) {
      safeLocalStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [codexInteractionMode, permissionMode, provider, selectedSession?.id, setCodexInteractionMode]);

  return {
    provider,
    setProvider,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    codexInteractionMode,
    setCodexInteractionMode,
    codexApprovalPolicy,
    setCodexApprovalPolicy,
    codexReasoningEffort,
    setCodexReasoningEffort,
    handleCodexSessionCreated,
    geminiModel,
    setGeminiModel,
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  };
}
