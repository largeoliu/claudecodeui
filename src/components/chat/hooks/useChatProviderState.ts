import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { CLAUDE_MODELS, CODEX_MODELS, CURSOR_MODELS, GEMINI_MODELS } from '../../../../shared/modelConstants';
import type {
  CodexApprovalPolicy,
  CodexInteractionMode,
  PendingPermissionRequest,
  PermissionMode,
} from '../types/types';
import type { ProjectSession, SessionProvider } from '../../../types/app';
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

const isCodexInteractionMode = (value: unknown): value is CodexInteractionMode => (
  value === 'edit' || value === 'plan'
);

const isCodexApprovalPolicy = (value: unknown): value is CodexApprovalPolicy => (
  value === 'untrusted' || value === 'on-request' || value === 'never'
);

const getStoredProvider = (): SessionProvider => (
  (safeLocalStorage.getItem('selected-provider') as SessionProvider) || 'claude'
);

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
  return isCodexReasoningEffort(parsed.reasoningEffort)
    ? parsed.reasoningEffort
    : DEFAULT_CODEX_REASONING_EFFORT;
};

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [provider, setProvider] = useState<SessionProvider>(getStoredProvider);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [codexInteractionMode, setCodexInteractionModeState] = useState<CodexInteractionMode>(() => (
    getStoredProvider() === 'codex' ? getDefaultCodexInteractionMode() : DEFAULT_CODEX_INTERACTION_MODE
  ));
  const [codexApprovalPolicy, setCodexApprovalPolicyState] = useState<CodexApprovalPolicy>(() => (
    getStoredProvider() === 'codex' ? getDefaultCodexApprovalPolicy() : DEFAULT_CODEX_APPROVAL_POLICY
  ));
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<CodexReasoningEffort>(getDefaultCodexReasoningEffort);
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [cursorModel, setCursorModel] = useState<string>(() => (
    localStorage.getItem('cursor-model') || CURSOR_MODELS.DEFAULT
  ));
  const [claudeModel, setClaudeModel] = useState<string>(() => (
    localStorage.getItem('claude-model') || CLAUDE_MODELS.DEFAULT
  ));
  const [codexModel, setCodexModel] = useState<string>(() => (
    localStorage.getItem('codex-model') || CODEX_MODELS.DEFAULT
  ));
  const [geminiModel, setGeminiModel] = useState<string>(() => (
    localStorage.getItem('gemini-model') || GEMINI_MODELS.DEFAULT
  ));

  const lastProviderRef = useRef(provider);
  const hasPersistedCodexReasoningRef = useRef(false);

  useEffect(() => {
    if (!selectedSession?.id) {
      if (provider === 'codex') {
        setCodexInteractionModeState(getDefaultCodexInteractionMode());
        setCodexApprovalPolicyState(getDefaultCodexApprovalPolicy());
      }
      return;
    }

    if (provider === 'codex') {
      const savedInteractionMode = safeLocalStorage.getItem(`${CODEX_INTERACTION_MODE_PREFIX}${selectedSession.id}`);
      const savedApprovalPolicy = safeLocalStorage.getItem(`${CODEX_APPROVAL_POLICY_PREFIX}${selectedSession.id}`);

      setCodexInteractionModeState(
        isCodexInteractionMode(savedInteractionMode)
          ? savedInteractionMode
          : getDefaultCodexInteractionMode(),
      );
      setCodexApprovalPolicyState(
        isCodexApprovalPolicy(savedApprovalPolicy)
          ? savedApprovalPolicy
          : getDefaultCodexApprovalPolicy(),
      );
      return;
    }

    const savedMode = safeLocalStorage.getItem(`permissionMode-${selectedSession.id}`);
    setPermissionMode((savedMode as PermissionMode) || 'default');
  }, [selectedSession?.id, provider]);

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

  const setCodexInteractionMode = useCallback((nextMode: CodexInteractionMode) => {
    setCodexInteractionModeState(nextMode);

    if (selectedSession?.id) {
      safeLocalStorage.setItem(`${CODEX_INTERACTION_MODE_PREFIX}${selectedSession.id}`, nextMode);
    }
  }, [selectedSession?.id]);

  const setCodexApprovalPolicy = useCallback((nextPolicy: CodexApprovalPolicy) => {
    setCodexApprovalPolicyState(nextPolicy);

    if (selectedSession?.id) {
      safeLocalStorage.setItem(`${CODEX_APPROVAL_POLICY_PREFIX}${selectedSession.id}`, nextPolicy);
    }
  }, [selectedSession?.id]);

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
    cursorModel,
    setCursorModel,
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
    geminiModel,
    setGeminiModel,
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  };
}
