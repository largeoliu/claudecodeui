import request from 'supertest';
import { vi } from 'vitest';
import { createTestApp } from '../../helpers/create-test-app.js';

const codexRouteMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  homedir: vi.fn(() => '/mock-home'),
  getCodexSessions: vi.fn(),
  getCodexSessionMessages: vi.fn(),
  deleteCodexSession: vi.fn(),
  applyCustomSessionNames: vi.fn(),
  deleteName: vi.fn(),
  createRequestAbortController: vi.fn(),
  runCommand: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    readFile: codexRouteMocks.readFile,
  },
}));

vi.mock('os', () => ({
  default: {
    homedir: codexRouteMocks.homedir,
  },
  homedir: codexRouteMocks.homedir,
}));

vi.mock('../../../server/projects.js', () => ({
  getCodexSessions: codexRouteMocks.getCodexSessions,
  getCodexSessionMessages: codexRouteMocks.getCodexSessionMessages,
  deleteCodexSession: codexRouteMocks.deleteCodexSession,
}));

vi.mock('../../../server/database/db.js', () => ({
  applyCustomSessionNames: codexRouteMocks.applyCustomSessionNames,
  sessionNamesDb: {
    deleteName: codexRouteMocks.deleteName,
  },
}));

vi.mock('../../../server/utils/process-runner.js', () => ({
  createRequestAbortController: codexRouteMocks.createRequestAbortController,
  runCommand: codexRouteMocks.runCommand,
}));

import router from '../../../server/routes/codex.js';

describe('codex routes', () => {
  let cleanupSpy;

  beforeEach(() => {
    cleanupSpy = vi.fn();

    codexRouteMocks.readFile.mockReset();
    codexRouteMocks.homedir.mockReset();
    codexRouteMocks.getCodexSessions.mockReset();
    codexRouteMocks.getCodexSessionMessages.mockReset();
    codexRouteMocks.deleteCodexSession.mockReset();
    codexRouteMocks.applyCustomSessionNames.mockReset();
    codexRouteMocks.deleteName.mockReset();
    codexRouteMocks.createRequestAbortController.mockReset();
    codexRouteMocks.runCommand.mockReset();

    codexRouteMocks.homedir.mockReturnValue('/mock-home');
    codexRouteMocks.createRequestAbortController.mockImplementation(() => ({
      signal: { aborted: false },
      cleanup: cleanupSpy,
    }));
  });

  it('reads Codex config and falls back when the config file is missing', async () => {
    const app = createTestApp(router);

    codexRouteMocks.readFile.mockResolvedValueOnce([
      'model = "gpt-5-codex"',
      'approval_mode = "never"',
      '[mcp_servers.demo]',
      'command = "node"',
    ].join('\n'));

    const configuredResponse = await request(app).get('/config');

    expect(configuredResponse.status).toBe(200);
    expect(configuredResponse.body).toEqual({
      success: true,
      config: {
        model: 'gpt-5-codex',
        mcpServers: {
          demo: {
            command: 'node',
          },
        },
        approvalMode: 'never',
      },
    });

    codexRouteMocks.readFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    const missingResponse = await request(app).get('/config');

    expect(missingResponse.status).toBe(200);
    expect(missingResponse.body).toEqual({
      success: true,
      config: {
        model: null,
        mcpServers: {},
        approvalMode: 'suggest',
      },
    });
  });

  it('validates session listing and applies custom Codex session names', async () => {
    const app = createTestApp(router);

    const missingPathResponse = await request(app).get('/sessions');
    expect(missingPathResponse.status).toBe(400);
    expect(missingPathResponse.body).toEqual({
      success: false,
      error: 'projectPath query parameter required',
    });

    codexRouteMocks.getCodexSessions.mockResolvedValue([{ id: 'session-1', summary: 'Original summary' }]);
    codexRouteMocks.applyCustomSessionNames.mockImplementation((sessions, provider) => {
      sessions[0].summary = `Renamed by ${provider}`;
    });

    const successResponse = await request(app)
      .get('/sessions')
      .query({ projectPath: '/work/demo-project' });

    expect(successResponse.status).toBe(200);
    expect(codexRouteMocks.getCodexSessions).toHaveBeenCalledWith('/work/demo-project');
    expect(codexRouteMocks.applyCustomSessionNames).toHaveBeenCalledWith(
      [{ id: 'session-1', summary: 'Renamed by codex' }],
      'codex',
    );
    expect(successResponse.body).toEqual({
      success: true,
      sessions: [{ id: 'session-1', summary: 'Renamed by codex' }],
    });
  });

  it('passes through Codex session message errors and session deletions', async () => {
    const app = createTestApp(router);

    codexRouteMocks.getCodexSessionMessages.mockRejectedValueOnce(
      Object.assign(new Error('Unsupported transcript format'), {
        statusCode: 501,
        unsupported: true,
        code: 'unsupported_format',
      }),
    );

    const messagesResponse = await request(app)
      .get('/sessions/session-1/messages')
      .query({ limit: '20', offset: '5' });

    expect(messagesResponse.status).toBe(501);
    expect(messagesResponse.body).toEqual({
      success: false,
      error: 'Unsupported transcript format',
      unsupported: true,
      code: 'unsupported_format',
    });
    expect(codexRouteMocks.getCodexSessionMessages).toHaveBeenCalledWith('session-1', 20, 5);

    codexRouteMocks.deleteCodexSession.mockResolvedValue(undefined);

    const deleteResponse = await request(app).delete('/sessions/session-1');

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({ success: true });
    expect(codexRouteMocks.deleteCodexSession).toHaveBeenCalledWith('session-1');
    expect(codexRouteMocks.deleteName).toHaveBeenCalledWith('session-1', 'codex');
  });

  it('lists MCP servers via the Codex CLI and parses connection statuses', async () => {
    const app = createTestApp(router);
    codexRouteMocks.runCommand.mockResolvedValue({
      stdout: ['demo: Local server - ✓ Connected', 'offline: Broken server - ✗ Failed'].join('\n'),
    });

    const response = await request(app).get('/mcp/cli/list');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      output: 'demo: Local server - ✓ Connected\noffline: Broken server - ✗ Failed',
      servers: [
        { name: 'demo', type: 'stdio', status: 'connected', description: 'Local server' },
        { name: 'offline', type: 'stdio', status: 'failed', description: 'Broken server' },
      ],
    });
    expect(codexRouteMocks.runCommand).toHaveBeenCalledWith(
      'codex',
      ['mcp', 'list'],
      expect.objectContaining({
        timeoutMs: 30000,
        maxStdoutBytes: 262144,
        maxStderrBytes: 262144,
      }),
    );
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('returns gateway timeout when the Codex CLI exceeds the time limit', async () => {
    const app = createTestApp(router);
    codexRouteMocks.runCommand.mockRejectedValue(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));

    const response = await request(app).get('/mcp/cli/list');

    expect(response.status).toBe(504);
    expect(response.body).toEqual({
      error: 'Command timed out',
      details: 'Process exceeded 30s limit',
    });
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('returns service unavailable when the Codex CLI is missing', async () => {
    const app = createTestApp(router);
    codexRouteMocks.runCommand.mockRejectedValue(
      Object.assign(new Error('spawn codex ENOENT'), {
        code: 'ENOENT',
        stderr: 'codex not found',
      }),
    );

    const response = await request(app).get('/mcp/cli/list');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: 'Codex CLI not installed',
      details: 'codex not found',
      code: 'ENOENT',
    });
  });

  it('validates and builds Codex MCP add commands', async () => {
    const app = createTestApp(router);

    const invalidResponse = await request(app).post('/mcp/cli/add').send({ name: '', command: '' });
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body).toEqual({ error: 'name and command are required' });

    codexRouteMocks.runCommand.mockResolvedValue({ stdout: 'Added MCP server demo' });

    const successResponse = await request(app).post('/mcp/cli/add').send({
      name: 'demo',
      command: 'npx',
      args: ['server.js', '--watch'],
      env: { API_KEY: 'secret', MODE: 'test' },
    });

    expect(successResponse.status).toBe(200);
    expect(successResponse.body).toEqual({
      success: true,
      output: 'Added MCP server demo',
      message: 'MCP server "demo" added successfully',
    });
    expect(codexRouteMocks.runCommand).toHaveBeenCalledWith(
      'codex',
      ['mcp', 'add', 'demo', '-e', 'API_KEY=secret', '-e', 'MODE=test', '--', 'npx', 'server.js', '--watch'],
      expect.any(Object),
    );
  });

  it('reads MCP CLI details and parses JSON payloads', async () => {
    const app = createTestApp(router);
    codexRouteMocks.runCommand.mockResolvedValue({
      stdout: '{"name":"demo","type":"stdio","command":"node","args":["server.js"]}',
    });

    const response = await request(app).get('/mcp/cli/get/demo');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      output: '{"name":"demo","type":"stdio","command":"node","args":["server.js"]}',
      server: {
        name: 'demo',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      },
    });
  });

  it('reads Codex MCP config files and exposes configured user servers', async () => {
    const app = createTestApp(router);

    codexRouteMocks.readFile.mockResolvedValue([
      '[mcp_servers.demo]',
      'command = "node"',
      'args = ["server.js"]',
      '[mcp_servers.demo.env]',
      'API_KEY = "secret"',
    ].join('\n'));

    const response = await request(app).get('/mcp/config/read');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      configPath: '/mock-home/.codex/config.toml',
      servers: [
        {
          id: 'demo',
          name: 'demo',
          type: 'stdio',
          scope: 'user',
          config: {
            command: 'node',
            args: ['server.js'],
            env: { API_KEY: 'secret' },
          },
          raw: {
            command: 'node',
            args: ['server.js'],
            env: { API_KEY: 'secret' },
          },
        },
      ],
    });
  });
});
