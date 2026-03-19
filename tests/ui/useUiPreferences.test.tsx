// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useUiPreferences } from '../../src/hooks/useUiPreferences';

describe('useUiPreferences', () => {
  it('uses defaults when there is no stored state', () => {
    const { result } = renderHook(() => useUiPreferences('demo-ui-preferences'));

    expect(result.current.preferences).toEqual({
      autoExpandTools: false,
      showRawParameters: false,
      showThinking: true,
      autoScrollToBottom: true,
      sendByCtrlEnter: false,
      sidebarVisible: true,
    });
  });

  it('hydrates from unified storage or legacy keys', () => {
    localStorage.setItem('uiPreferences', JSON.stringify({
      autoExpandTools: true,
      showRawParameters: true,
      showThinking: false,
      autoScrollToBottom: false,
      sendByCtrlEnter: true,
      sidebarVisible: false,
    }));

    const unified = renderHook(() => useUiPreferences());
    expect(unified.result.current.preferences).toEqual({
      autoExpandTools: true,
      showRawParameters: true,
      showThinking: false,
      autoScrollToBottom: false,
      sendByCtrlEnter: true,
      sidebarVisible: false,
    });

    localStorage.clear();
    localStorage.setItem('showThinking', 'false');
    localStorage.setItem('autoScrollToBottom', '"false"');

    const legacy = renderHook(() => useUiPreferences('legacy-ui-preferences'));
    expect(legacy.result.current.preferences.showThinking).toBe(false);
    expect(legacy.result.current.preferences.autoScrollToBottom).toBe(false);
  });

  it('updates and resets preferences while persisting to localStorage', () => {
    const { result } = renderHook(() => useUiPreferences('demo-ui-preferences'));

    act(() => {
      result.current.setPreference('showThinking', false);
      result.current.setPreferences({ autoExpandTools: true, sidebarVisible: false });
    });

    expect(result.current.preferences).toMatchObject({
      showThinking: false,
      autoExpandTools: true,
      sidebarVisible: false,
    });
    expect(JSON.parse(localStorage.getItem('demo-ui-preferences') || '{}')).toMatchObject({
      showThinking: false,
      autoExpandTools: true,
      sidebarVisible: false,
    });

    act(() => {
      result.current.resetPreferences({ sidebarVisible: false });
    });

    expect(result.current.preferences).toEqual({
      autoExpandTools: false,
      showRawParameters: false,
      showThinking: true,
      autoScrollToBottom: true,
      sendByCtrlEnter: false,
      sidebarVisible: false,
    });
  });

  it('syncs updates across hook instances and storage events', async () => {
    const first = renderHook(() => useUiPreferences('shared-ui-preferences'));
    const second = renderHook(() => useUiPreferences('shared-ui-preferences'));

    act(() => {
      first.result.current.setPreference('showThinking', false);
    });

    await waitFor(() => {
      expect(second.result.current.preferences.showThinking).toBe(false);
    });

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'shared-ui-preferences',
        newValue: JSON.stringify({ showThinking: true, sidebarVisible: false }),
      }));
    });

    await waitFor(() => {
      expect(first.result.current.preferences.showThinking).toBe(true);
      expect(first.result.current.preferences.sidebarVisible).toBe(false);
    });
  });
});
