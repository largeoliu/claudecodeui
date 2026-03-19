// @vitest-environment jsdom

import {
  createSessionViewModel,
  filterProjects,
  getAllSessions,
  getProjectLastActivity,
  getSessionDate,
  getSessionName,
  getSessionTime,
  getTaskIndicatorStatus,
  loadStarredProjects,
  normalizeProjectForSettings,
  persistStarredProjects,
  readProjectSortOrder,
  sortProjects,
} from '../../src/components/sidebar/utils/utils';

const t = (key: string) => key;

describe('sidebar utils', () => {
  const projectA = {
    name: 'alpha',
    displayName: 'Alpha',
    fullPath: '/work/alpha',
    sessions: [{ id: 'claude-1', summary: 'Claude Summary', lastActivity: '2026-03-20T11:00:00Z' }],
    cursorSessions: [{ id: 'cursor-1', name: 'Cursor Name', createdAt: '2026-03-20T10:00:00Z' }],
    codexSessions: [{ id: 'codex-1', summary: 'Codex Summary', createdAt: '2026-03-20T09:00:00Z' }],
    geminiSessions: [{ id: 'gemini-1', summary: 'Gemini Summary', lastActivity: '2026-03-20T08:00:00Z' }],
    taskmaster: { hasTaskmaster: true },
  };

  const projectB = {
    name: 'beta',
    displayName: 'Beta',
    fullPath: '/work/beta',
    sessions: [{ id: 'claude-2', summary: 'Older Claude', lastActivity: '2026-03-19T08:00:00Z' }],
    taskmaster: { hasTaskmaster: false },
  };

  it('reads and persists sidebar preferences in localStorage', () => {
    expect(readProjectSortOrder()).toBe('name');

    localStorage.setItem('claude-settings', JSON.stringify({ projectSortOrder: 'date' }));
    expect(readProjectSortOrder()).toBe('date');

    persistStarredProjects(new Set(['alpha', 'beta']));
    expect(loadStarredProjects()).toEqual(new Set(['alpha', 'beta']));
  });

  it('derives session names, times, and dates per provider', () => {
    expect(getSessionName({ __provider: 'cursor', summary: '', name: 'Cursor Name' }, t)).toBe('Cursor Name');
    expect(getSessionName({ __provider: 'codex', summary: '', name: '' }, t)).toBe('projects.codexSession');
    expect(getSessionName({ __provider: 'gemini', summary: '', name: '' }, t)).toBe('projects.newSession');
    expect(getSessionName({ __provider: 'claude', summary: '' }, t)).toBe('projects.newSession');

    expect(getSessionTime({ __provider: 'cursor', createdAt: '2026-03-20T10:00:00Z' })).toBe('2026-03-20T10:00:00Z');
    expect(getSessionTime({ __provider: 'codex', lastActivity: '2026-03-20T09:00:00Z' })).toBe('2026-03-20T09:00:00Z');
    expect(getSessionTime({ __provider: 'claude', lastActivity: '2026-03-20T11:00:00Z' })).toBe('2026-03-20T11:00:00Z');

    expect(getSessionDate({ __provider: 'cursor', createdAt: '2026-03-20T10:00:00Z' }).toISOString()).toBe('2026-03-20T10:00:00.000Z');
  });

  it('creates session view models and merges sessions across providers', () => {
    const currentTime = new Date('2026-03-20T11:05:00Z');
    const model = createSessionViewModel(
      { __provider: 'claude', summary: 'Recent Claude', lastActivity: '2026-03-20T11:00:00Z', messageCount: 3 },
      currentTime,
      t,
    );

    expect(model).toEqual({
      isCursorSession: false,
      isCodexSession: false,
      isGeminiSession: false,
      isActive: true,
      isRecent: true,
      sessionName: 'Recent Claude',
      sessionTime: '2026-03-20T11:00:00Z',
      messageCount: 3,
    });

    const allSessions = getAllSessions(projectA, { alpha: [{ id: 'extra', summary: 'Extra', lastActivity: '2026-03-20T12:00:00Z' }] });
    expect(allSessions.map((session) => session.id)).toEqual(['extra', 'claude-1', 'cursor-1', 'codex-1', 'gemini-1']);
    expect(getProjectLastActivity(projectA, { alpha: [{ id: 'extra', summary: 'Extra', lastActivity: '2026-03-20T12:00:00Z' }] }).toISOString()).toBe('2026-03-20T12:00:00.000Z');
  });

  it('sorts, filters, and normalizes projects for settings', () => {
    const starred = new Set(['beta']);
    expect(sortProjects([projectA, projectB], 'name', starred, {} as never).map((project) => project.name)).toEqual(['beta', 'alpha']);
    expect(sortProjects([projectA, projectB], 'date', new Set(), {} as never).map((project) => project.name)).toEqual(['alpha', 'beta']);

    expect(filterProjects([projectA, projectB], 'alp')).toEqual([projectA]);
    expect(filterProjects([projectA, projectB], 'BETA')).toEqual([projectB]);

    expect(normalizeProjectForSettings({ name: 'demo', displayName: '', path: '/work/demo' } as never)).toEqual({
      name: 'demo',
      displayName: 'demo',
      fullPath: '/work/demo',
      path: '/work/demo',
    });
  });

  it('reports TaskMaster / MCP indicator states', () => {
    expect(getTaskIndicatorStatus(projectA as never, { hasMCPServer: true, isConfigured: true })).toBe('fully-configured');
    expect(getTaskIndicatorStatus(projectA as never, { hasMCPServer: false, isConfigured: false })).toBe('taskmaster-only');
    expect(getTaskIndicatorStatus(projectB as never, { hasMCPServer: true, isConfigured: true })).toBe('mcp-only');
    expect(getTaskIndicatorStatus(projectB as never, null)).toBe('not-configured');
  });
});
