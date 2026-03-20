import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { vi } from 'vitest';
import { createTestApp } from '../../helpers/create-test-app.js';
import { withServerTestEnv } from '../../helpers/server-test-env.js';

const projectsMocks = vi.hoisted(() => ({
  addProjectManually: vi.fn(),
}));

vi.mock('../../../server/projects.js', () => ({
  addProjectManually: projectsMocks.addProjectManually,
}));

describe('projects routes', () => {
  beforeEach(() => {
    projectsMocks.addProjectManually.mockReset();
  });

  it('validates create-workspace requests before touching the filesystem', async () => {
    await withServerTestEnv(async ({ importServerModule }) => {
      const { default: router } = await importServerModule('../../server/routes/projects.js');
      const app = createTestApp(router, { user: { id: 1, username: 'alice' } });

      const missingFieldsResponse = await request(app).post('/create-workspace').send({});
      expect(missingFieldsResponse.status).toBe(400);

      const invalidTypeResponse = await request(app).post('/create-workspace').send({
        workspaceType: 'clone',
        path: '/tmp/demo',
      });
      expect(invalidTypeResponse.status).toBe(400);

      const forbiddenPathResponse = await request(app).post('/create-workspace').send({
        workspaceType: 'new',
        path: '/etc',
      });
      expect(forbiddenPathResponse.status).toBe(400);
      expect(forbiddenPathResponse.body.details).toContain('system directory');
    });
  });

  it('adds existing workspaces and rejects invalid existing paths', async () => {
    await withServerTestEnv(async ({ tempDir, importServerModule }) => {
      const { default: router } = await importServerModule('../../server/routes/projects.js');
      const app = createTestApp(router, { user: { id: 1, username: 'alice' } });
      const existingDir = path.join(tempDir, 'existing-workspace');
      const existingFile = path.join(tempDir, 'not-a-directory.txt');
      await fs.mkdir(existingDir, { recursive: true });
      await fs.writeFile(existingFile, 'nope', 'utf8');

      const missingResponse = await request(app).post('/create-workspace').send({
        workspaceType: 'existing',
        path: path.join(tempDir, 'missing-workspace'),
      });
      expect(missingResponse.status).toBe(404);

      const fileResponse = await request(app).post('/create-workspace').send({
        workspaceType: 'existing',
        path: existingFile,
      });
      expect(fileResponse.status).toBe(400);

      projectsMocks.addProjectManually.mockResolvedValue({
        name: 'existing-workspace',
        displayName: 'existing-workspace',
        fullPath: existingDir,
      });

      const successResponse = await request(app).post('/create-workspace').send({
        workspaceType: 'existing',
        path: existingDir,
      });

      expect(successResponse.status).toBe(200);
      expect(successResponse.body).toEqual({
        success: true,
        project: {
          name: 'existing-workspace',
          displayName: 'existing-workspace',
          fullPath: existingDir,
        },
        message: 'Existing workspace added successfully',
      });
      expect(projectsMocks.addProjectManually).toHaveBeenCalledWith(existingDir);
    });
  });

  it('creates new workspaces and detects clone target collisions before cloning', async () => {
    await withServerTestEnv(async ({ tempDir, importServerModule }) => {
      const { default: router } = await importServerModule('../../server/routes/projects.js');
      const app = createTestApp(router, { user: { id: 1, username: 'alice' } });
      const newWorkspace = path.join(tempDir, 'new-workspace');

      projectsMocks.addProjectManually.mockResolvedValue({
        name: 'new-workspace',
        displayName: 'new-workspace',
        fullPath: newWorkspace,
      });

      const createResponse = await request(app).post('/create-workspace').send({
        workspaceType: 'new',
        path: newWorkspace,
      });

      expect(createResponse.status).toBe(200);
      expect(createResponse.body.message).toBe('New workspace created successfully');
      await expect(fs.stat(newWorkspace)).resolves.toMatchObject({ isDirectory: expect.any(Function) });

      const cloneRoot = path.join(tempDir, 'clone-workspace');
      await fs.mkdir(path.join(cloneRoot, 'repo'), { recursive: true });

      const collisionResponse = await request(app).post('/create-workspace').send({
        workspaceType: 'new',
        path: cloneRoot,
        githubUrl: 'https://github.com/acme/repo.git',
      });

      expect(collisionResponse.status).toBe(409);
      expect(collisionResponse.body.error).toBe('Directory already exists');
    });
  });

  it('does not delete the workspace root when github credentials are missing', async () => {
    await withServerTestEnv(async ({ tempDir, importServerModule }) => {
      const { default: router } = await importServerModule('../../server/routes/projects.js');
      const app = createTestApp(router, { user: { id: 1, username: 'alice' } });
      const newWorkspace = path.join(tempDir, 'missing-token-workspace');

      const response = await request(app).post('/create-workspace').send({
        workspaceType: 'new',
        path: newWorkspace,
        githubUrl: 'https://github.com/acme/repo.git',
        githubTokenId: 999,
      });

      expect(response.status).toBe(404);
      await expect(fs.stat(newWorkspace)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    });
  });
});
