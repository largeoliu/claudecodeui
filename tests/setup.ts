import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  if (typeof document !== 'undefined') {
    cleanup();
    document.body.innerHTML = '';
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
