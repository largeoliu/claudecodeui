import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  homedir: vi.fn(() => '/mock-home'),
}));

vi.mock('fs', () => ({
  promises: {
    readFile: mocks.readFile,
  },
}));

vi.mock('os', () => ({
  default: {
    homedir: mocks.homedir,
  },
  homedir: mocks.homedir,
}));

describe('mcp-detector', () => {
  beforeEach(() => {
    mocks.readFile.mockReset();
  });

  it('reports when no Claude config files exist', async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const { detectTaskMasterMCPServer } = await import('../../../server/utils/mcp-detector.js');

    await expect(detectTaskMasterMCPServer()).resolves.toEqual({
      hasMCPServer: false,
      reason: 'No Claude configuration file found',
      hasConfig: false,
    });
  });

  it('detects a globally configured TaskMaster MCP server', async () => {
    mocks.readFile.mockResolvedValueOnce(JSON.stringify({
      mcpServers: {
        'task-master-ai': {
          command: 'npx',
          args: ['task-master-ai'],
          env: { OPENAI_API_KEY: 'secret' },
        },
      },
    }));

    const { detectTaskMasterMCPServer } = await import('../../../server/utils/mcp-detector.js');
    const result = await detectTaskMasterMCPServer();

    expect(result).toEqual({
      hasMCPServer: true,
      isConfigured: true,
      hasApiKeys: true,
      scope: 'user',
      config: {
        command: 'npx',
        args: ['task-master-ai'],
        url: undefined,
        envVars: ['OPENAI_API_KEY'],
        type: 'stdio',
      },
    });
  });

  it('falls back to project-local TaskMaster MCP definitions', async () => {
    mocks.readFile.mockResolvedValueOnce(JSON.stringify({
      mcpServers: {
        github: { command: 'github-mcp' },
      },
      projects: {
        '/work/demo': {
          mcpServers: {
            'task-master-local': {
              url: 'https://example.com/mcp',
            },
          },
        },
      },
    }));

    const { detectTaskMasterMCPServer } = await import('../../../server/utils/mcp-detector.js');
    const result = await detectTaskMasterMCPServer();

    expect(result).toEqual({
      hasMCPServer: true,
      isConfigured: true,
      hasApiKeys: false,
      scope: 'local',
      config: {
        command: undefined,
        args: [],
        url: 'https://example.com/mcp',
        envVars: [],
        type: 'http',
      },
    });
  });

  it('returns available server names when TaskMaster is absent', async () => {
    mocks.readFile.mockResolvedValueOnce(JSON.stringify({
      mcpServers: {
        github: { command: 'github-mcp' },
      },
      projects: {
        '/work/demo': {
          mcpServers: {
            localTools: { command: 'demo-tools' },
          },
        },
      },
    }));

    const { detectTaskMasterMCPServer } = await import('../../../server/utils/mcp-detector.js');
    const result = await detectTaskMasterMCPServer();

    expect(result).toEqual({
      hasMCPServer: false,
      reason: 'task-master-ai not found in configured MCP servers',
      hasConfig: true,
      configPath: '/mock-home/.claude.json',
      availableServers: ['github', 'local:localTools'],
    });
  });

  it('returns all configured global and project MCP servers', async () => {
    mocks.readFile
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
      .mockResolvedValueOnce(JSON.stringify({
        mcpServers: {
          github: { command: 'github-mcp' },
        },
        projects: {
          '/work/demo': {
            mcpServers: {
              localTools: { command: 'demo-tools' },
            },
          },
        },
      }));

    const { getAllMCPServers } = await import('../../../server/utils/mcp-detector.js');
    const result = await getAllMCPServers();

    expect(result).toEqual({
      hasConfig: true,
      configPath: '/mock-home/.claude/settings.json',
      servers: {
        github: { command: 'github-mcp' },
      },
      projectServers: {
        '/work/demo': {
          mcpServers: {
            localTools: { command: 'demo-tools' },
          },
        },
      },
    });
  });
});
