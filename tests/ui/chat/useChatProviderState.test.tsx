// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useChatProviderState } from '../../../src/components/chat/hooks/useChatProviderState';

const selectedProject = {
  name: 'demo-project',
  displayName: 'Demo Project',
  fullPath: '/work/demo-project',
} as any;

describe('useChatProviderState', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('syncs codex session settings from the session-scoped blob', async () => {
    localStorage.setItem('selected-provider', 'claude');
    localStorage.setItem('chat-session-settings:codex:codex-session', JSON.stringify({
      model: 'gpt-5.2',
      interactionMode: 'plan',
      approvalPolicy: 'never',
      reasoningEffort: 'high',
    }));

    const { result } = renderHook(() => useChatProviderState({
      selectedProject,
      selectedSession: { id: 'codex-session', __provider: 'codex' } as any,
      currentSessionId: 'codex-session',
    }));

    await waitFor(() => {
      expect(result.current.provider).toBe('codex');
    });

    expect(result.current.codexModel).toBe('gpt-5.2');
    expect(result.current.codexInteractionMode).toBe('plan');
    expect(result.current.codexApprovalPolicy).toBe('never');
    expect(result.current.codexReasoningEffort).toBe('high');
  });

  it('falls back to legacy codex settings for sessions without session-scoped storage', async () => {
    localStorage.setItem('selected-provider', 'codex');
    localStorage.setItem('codex-model', 'gpt-5.3-codex');
    localStorage.setItem('codex-settings', JSON.stringify({
      interactionMode: 'plan',
      approvalPolicy: 'on-request',
      reasoningEffort: 'medium',
    }));
    localStorage.setItem('codex-interaction-mode-codex-session', 'edit');
    localStorage.setItem('codex-approval-policy-codex-session', 'never');

    const { result } = renderHook(() => useChatProviderState({
      selectedProject,
      selectedSession: { id: 'codex-session', __provider: 'codex' } as any,
      currentSessionId: 'codex-session',
    }));

    await waitFor(() => {
      expect(result.current.codexModel).toBe('gpt-5.3-codex');
      expect(result.current.codexInteractionMode).toBe('edit');
      expect(result.current.codexApprovalPolicy).toBe('never');
      expect(result.current.codexReasoningEffort).toBe('medium');
    });
  });

  it('persists codex setting updates to the session-scoped blob', async () => {
    localStorage.setItem('selected-provider', 'codex');

    const { result } = renderHook(() => useChatProviderState({
      selectedProject,
      selectedSession: { id: 'codex-session', __provider: 'codex' } as any,
      currentSessionId: 'codex-session',
    }));

    act(() => {
      result.current.setCodexModel('gpt-5.2');
      result.current.setCodexInteractionMode('plan');
      result.current.setCodexApprovalPolicy('never');
      result.current.setCodexReasoningEffort('high');
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('chat-session-settings:codex:codex-session') || '{}')).toMatchObject({
        model: 'gpt-5.2',
        interactionMode: 'plan',
        approvalPolicy: 'never',
        reasoningEffort: 'high',
      });
    });
  });

  it('hydrates draft codex settings and migrates them on session creation', async () => {
    localStorage.setItem('selected-provider', 'codex');
    localStorage.setItem('chat-draft-settings:/work/demo-project:codex', JSON.stringify({
      model: 'gpt-5.2-codex',
      interactionMode: 'plan',
      approvalPolicy: 'never',
      reasoningEffort: 'high',
    }));

    const { result } = renderHook(() => useChatProviderState({
      selectedProject,
      selectedSession: null,
      currentSessionId: null,
    }));

    await waitFor(() => {
      expect(result.current.codexModel).toBe('gpt-5.2-codex');
    });

    act(() => {
      result.current.handleCodexSessionCreated('codex-session');
    });

    expect(localStorage.getItem('chat-draft-settings:/work/demo-project:codex')).toBeNull();
    expect(JSON.parse(localStorage.getItem('chat-session-settings:codex:codex-session') || '{}')).toMatchObject({
      model: 'gpt-5.2-codex',
      interactionMode: 'plan',
      approvalPolicy: 'never',
      reasoningEffort: 'high',
    });
  });

  it('coerces unsupported reasoning effort when hydrating a weaker model', async () => {
    localStorage.setItem('selected-provider', 'codex');
    localStorage.setItem('chat-session-settings:codex:codex-session', JSON.stringify({
      model: 'o3',
      interactionMode: 'edit',
      approvalPolicy: 'on-request',
      reasoningEffort: 'xhigh',
    }));

    const { result } = renderHook(() => useChatProviderState({
      selectedProject,
      selectedSession: { id: 'codex-session', __provider: 'codex' } as any,
      currentSessionId: 'codex-session',
    }));

    await waitFor(() => {
      expect(result.current.codexModel).toBe('o3');
    });

    expect(result.current.codexReasoningEffort).toBe('high');
  });

  it('preserves xhigh reasoning effort for supported models', async () => {
    localStorage.setItem('selected-provider', 'codex');
    localStorage.setItem('chat-session-settings:codex:codex-session', JSON.stringify({
      model: 'gpt-5.2',
      interactionMode: 'edit',
      approvalPolicy: 'on-request',
      reasoningEffort: 'xhigh',
    }));

    const { result } = renderHook(() => useChatProviderState({
      selectedProject,
      selectedSession: { id: 'codex-session', __provider: 'codex' } as any,
      currentSessionId: 'codex-session',
    }));

    await waitFor(() => {
      expect(result.current.codexModel).toBe('gpt-5.2');
    });

    expect(result.current.codexReasoningEffort).toBe('xhigh');
  });

  it('downgrades reasoning effort when switching to a model without high support', async () => {
    localStorage.setItem('selected-provider', 'codex');

    const { result } = renderHook(() => useChatProviderState({
      selectedProject,
      selectedSession: { id: 'codex-session', __provider: 'codex' } as any,
      currentSessionId: 'codex-session',
    }));

    act(() => {
      result.current.setCodexReasoningEffort('xhigh');
      result.current.setCodexModel('o4-mini');
    });

    await waitFor(() => {
      expect(result.current.codexModel).toBe('o4-mini');
    });

    expect(result.current.codexReasoningEffort).toBe('medium');
    expect(JSON.parse(localStorage.getItem('chat-session-settings:codex:codex-session') || '{}')).toMatchObject({
      model: 'o4-mini',
      reasoningEffort: 'medium',
    });
  });

  it('cycles Claude permission modes and persists them per session', async () => {
    localStorage.setItem('selected-provider', 'claude');
    localStorage.setItem('permissionMode-claude-session', 'acceptEdits');

    const { result } = renderHook(() => useChatProviderState({
      selectedProject,
      selectedSession: { id: 'claude-session', __provider: 'claude' } as any,
      currentSessionId: 'claude-session',
    }));

    await waitFor(() => {
      expect(result.current.permissionMode).toBe('acceptEdits');
    });

    act(() => {
      result.current.cyclePermissionMode();
    });

    expect(result.current.permissionMode).toBe('bypassPermissions');
    expect(localStorage.getItem('permissionMode-claude-session')).toBe('bypassPermissions');
  });
});
