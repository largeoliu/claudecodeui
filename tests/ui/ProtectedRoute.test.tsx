// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import ProtectedRoute from '../../src/components/auth/view/ProtectedRoute';

const protectedRouteMocks = vi.hoisted(() => ({
  isPlatform: false,
  useAuth: vi.fn(),
}));

vi.mock('../../src/constants/config', () => ({
  get IS_PLATFORM() {
    return protectedRouteMocks.isPlatform;
  },
}));

vi.mock('../../src/components/auth/context/AuthContext', () => ({
  useAuth: protectedRouteMocks.useAuth,
}));

vi.mock('../../src/components/onboarding/view/Onboarding', () => ({
  default: () => <div>Onboarding</div>,
}));

vi.mock('../../src/components/auth/view/AuthLoadingScreen', () => ({
  default: () => <div>Loading</div>,
}));

vi.mock('../../src/components/auth/view/LoginForm', () => ({
  default: () => <div>Login</div>,
}));

vi.mock('../../src/components/auth/view/SetupForm', () => ({
  default: () => <div>Setup</div>,
}));

describe('ProtectedRoute', () => {
  beforeEach(() => {
    protectedRouteMocks.isPlatform = false;
    protectedRouteMocks.useAuth.mockReturnValue({
      user: { username: 'alice' },
      isLoading: false,
      needsSetup: false,
      hasCompletedOnboarding: true,
      refreshOnboardingStatus: vi.fn(),
    });
  });

  it('renders the loading state while auth is pending', () => {
    protectedRouteMocks.useAuth.mockReturnValue({
      user: null,
      isLoading: true,
      needsSetup: false,
      hasCompletedOnboarding: false,
      refreshOnboardingStatus: vi.fn(),
    });

    render(
      <ProtectedRoute>
        <div>App Shell</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('shows setup or login states in OSS mode', () => {
    protectedRouteMocks.useAuth.mockReturnValueOnce({
      user: null,
      isLoading: false,
      needsSetup: true,
      hasCompletedOnboarding: false,
      refreshOnboardingStatus: vi.fn(),
    });

    const firstRender = render(
      <ProtectedRoute>
        <div>App Shell</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('Setup')).toBeInTheDocument();
    firstRender.unmount();

    protectedRouteMocks.useAuth.mockReturnValueOnce({
      user: null,
      isLoading: false,
      needsSetup: false,
      hasCompletedOnboarding: false,
      refreshOnboardingStatus: vi.fn(),
    });

    render(
      <ProtectedRoute>
        <div>App Shell</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('requires onboarding before rendering children', () => {
    protectedRouteMocks.useAuth.mockReturnValue({
      user: { username: 'alice' },
      isLoading: false,
      needsSetup: false,
      hasCompletedOnboarding: false,
      refreshOnboardingStatus: vi.fn(),
    });

    render(
      <ProtectedRoute>
        <div>App Shell</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Onboarding')).toBeInTheDocument();
  });

  it('renders children when the OSS user is fully authenticated', () => {
    render(
      <ProtectedRoute>
        <div>App Shell</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('App Shell')).toBeInTheDocument();
  });

  it('uses platform mode onboarding rules without requiring a user object', () => {
    protectedRouteMocks.isPlatform = true;
    protectedRouteMocks.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
      needsSetup: false,
      hasCompletedOnboarding: false,
      refreshOnboardingStatus: vi.fn(),
    });

    const { rerender } = render(
      <ProtectedRoute>
        <div>App Shell</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Onboarding')).toBeInTheDocument();

    protectedRouteMocks.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
      needsSetup: false,
      hasCompletedOnboarding: true,
      refreshOnboardingStatus: vi.fn(),
    });

    rerender(
      <ProtectedRoute>
        <div>App Shell</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('App Shell')).toBeInTheDocument();
  });
});
