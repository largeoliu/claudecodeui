// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const providerStateMocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
}));

vi.mock('../../../src/utils/api.js', () => ({
  authenticatedFetch: providerStateMocks.authenticatedFetch,
}));

import { useChatProviderState } from '../../../src/components/chat/hooks/useChatProviderState';

describe('useChatProviderState', () => {
  beforeEach(() => {
    providerStateMocks.authenticatedFetch.mockReset();
    localStorage.clear();
  });

  it('syncs the provider from the selected session and restores default codex settings', async () => {
    localStorage.setItem('selected-provider', 'claude');
    localStorage.setItem('codex-settings', JSON.stringify({
      interactionMode: 'plan',
      approvalPolicy: 'on-request',
      reasoningEffort: 'high',
    }));

    const { result } = renderHook(() => useChatProviderState({
      selectedSession: { id: 'codex-session', __provider: 'codex' } as any,
    }));

    await waitFor(() => {
      expect(result.current.provider).toBe('codex');
    });

    expect(localStorage.getItem('selected-provider')).toBe('codex');
    expect(result.current.codexInteractionMode).toBe('plan');
    expect(result.current.codexApprovalPolicy).toBe('on-request');
    expect(result.current.codexReasoningEffort).toBe('high');
  });

  it('loads per-session codex preferences and persists reasoning effort updates', async () => {
    localStorage.setItem('selected-provider', 'codex');
    localStorage.setItem('codex-settings', JSON.stringify({
      interactionMode: 'plan',
      approvalPolicy: 'on-request',
      reasoningEffort: 'medium',
    }));
    localStorage.setItem('codex-interaction-mode-codex-session', 'edit');
    localStorage.setItem('codex-approval-policy-codex-session', 'never');

    const { result } = renderHook(() => useChatProviderState({
      selectedSession: { id: 'codex-session', __provider: 'codex' } as any,
    }));

    await waitFor(() => {
      expect(result.current.codexInteractionMode).toBe('edit');
      expect(result.current.codexApprovalPolicy).toBe('never');
    });

    act(() => {
      result.current.setCodexReasoningEffort('high');
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('codex-settings') || '{}')).toMatchObject({
        reasoningEffort: 'high',
      });
    });
  });

  it('cycles Claude permission modes and persists them per session', async () => {
    localStorage.setItem('selected-provider', 'claude');
    localStorage.setItem('permissionMode-claude-session', 'acceptEdits');

    const { result } = renderHook(() => useChatProviderState({
      selectedSession: { id: 'claude-session', __provider: 'claude' } as any,
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

  it('cycles Codex interaction modes and clears pending permission requests on provider changes', async () => {
    localStorage.setItem('selected-provider', 'codex');
    localStorage.setItem('codex-interaction-mode-codex-session', 'edit');

    const { result } = renderHook(() => useChatProviderState({
      selectedSession: { id: 'codex-session', __provider: 'codex' } as any,
    }));

    await waitFor(() => {
      expect(result.current.provider).toBe('codex');
    });

    act(() => {
      result.current.setPendingPermissionRequests([
        { requestId: 'req-1', toolName: 'Bash', sessionId: 'codex-session' },
      ] as any);
    });

    act(() => {
      result.current.cyclePermissionMode();
    });

    expect(result.current.codexInteractionMode).toBe('plan');
    expect(localStorage.getItem('codex-interaction-mode-codex-session')).toBe('plan');

    act(() => {
      result.current.setProvider('claude');
    });

    await waitFor(() => {
      expect(result.current.pendingPermissionRequests).toEqual([]);
    });
  });

  it('hydrates the cursor model from the server when it is not already stored locally', async () => {
    localStorage.setItem('selected-provider', 'cursor');
    providerStateMocks.authenticatedFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        config: {
          model: {
            modelId: 'cursor-server-model',
          },
        },
      }),
    });

    const { result } = renderHook(() => useChatProviderState({
      selectedSession: { id: 'cursor-session', __provider: 'cursor' } as any,
    }));

    await waitFor(() => {
      expect(providerStateMocks.authenticatedFetch).toHaveBeenCalledWith('/api/cursor/config');
      expect(result.current.cursorModel).toBe('cursor-server-model');
    });
  });
});
