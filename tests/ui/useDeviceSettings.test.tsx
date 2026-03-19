// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useDeviceSettings } from '../../src/hooks/useDeviceSettings';

function installMatchMedia(initialMatches = false) {
  const listeners = new Set<(event: { matches: boolean }) => void>();

  const mediaQuery = {
    matches: initialMatches,
    media: '(display-mode: standalone)',
    addEventListener: (_event: string, listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
    dispatch(matches: boolean) {
      mediaQuery.matches = matches;
      listeners.forEach((listener) => listener({ matches }));
    },
  };

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => mediaQuery,
  });

  return mediaQuery;
}

describe('useDeviceSettings', () => {
  it('tracks mobile viewport changes', async () => {
    installMatchMedia(false);
    window.innerWidth = 480;

    const { result } = renderHook(() => useDeviceSettings());
    expect(result.current.isMobile).toBe(true);

    act(() => {
      window.innerWidth = 1024;
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => {
      expect(result.current.isMobile).toBe(false);
    });
  });

  it('tracks PWA display mode changes', async () => {
    const mediaQuery = installMatchMedia(false);
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: '',
    });

    const { result } = renderHook(() => useDeviceSettings());
    expect(result.current.isPWA).toBe(false);

    act(() => {
      mediaQuery.dispatch(true);
    });

    await waitFor(() => {
      expect(result.current.isPWA).toBe(true);
    });
  });

  it('respects tracking flags when disabled', () => {
    installMatchMedia(true);
    window.innerWidth = 400;

    const { result } = renderHook(() => useDeviceSettings({ trackMobile: false, trackPWA: false }));
    expect(result.current).toEqual({ isMobile: false, isPWA: false });
  });
});
