import request from 'supertest';
import { vi } from 'vitest';
import { createTestApp } from '../../helpers/create-test-app.js';

const detectorMocks = vi.hoisted(() => ({
  detectTaskMasterMCPServer: vi.fn(),
  getAllMCPServers: vi.fn(),
}));

vi.mock('../../../server/utils/mcp-detector.js', () => detectorMocks);

describe('mcp-utils routes', () => {
  it('returns TaskMaster detection results', async () => {
    detectorMocks.detectTaskMasterMCPServer.mockResolvedValue({ hasMCPServer: true, scope: 'user' });
    const { default: router } = await import('../../../server/routes/mcp-utils.js');
    const app = createTestApp(router);

    const response = await request(app).get('/taskmaster-server');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hasMCPServer: true, scope: 'user' });
  });

  it('returns the full MCP server map', async () => {
    detectorMocks.getAllMCPServers.mockResolvedValue({ hasConfig: true, servers: { demo: {} } });
    const { default: router } = await import('../../../server/routes/mcp-utils.js');
    const app = createTestApp(router);

    const response = await request(app).get('/all-servers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hasConfig: true, servers: { demo: {} } });
  });

  it('surfaces detector failures as API errors', async () => {
    detectorMocks.detectTaskMasterMCPServer.mockRejectedValue(new Error('boom'));
    const { default: router } = await import('../../../server/routes/mcp-utils.js');
    const app = createTestApp(router);

    const response = await request(app).get('/taskmaster-server');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to detect TaskMaster MCP server',
      message: 'boom',
    });
  });
});
