import fs from 'fs/promises';
import path from 'path';
import { withServerTestEnv } from '../../helpers/server-test-env.js';

describe('projects path helpers', () => {
  it('classifies root and forbidden workspace paths on Unix', async () => {
    await withServerTestEnv(async ({ importServerModule }) => {
      const {
        isBrowsableWorkspacePath,
        isFilesystemRootPath,
        isForbiddenWorkspacePath,
        validateBrowsableWorkspacePath,
        validateWorkspacePath,
      } = await importServerModule('../../server/routes/projects.js');

      expect(isFilesystemRootPath('/')).toBe(true);
      expect(isFilesystemRootPath('/tmp/workspace')).toBe(false);
      expect(isForbiddenWorkspacePath('/etc')).toBe(true);
      expect(isForbiddenWorkspacePath('/tmp/workspace')).toBe(false);
      expect(isBrowsableWorkspacePath('/')).toBe(true);
      expect(isBrowsableWorkspacePath('/etc')).toBe(false);

      await expect(validateWorkspacePath('/etc')).resolves.toEqual({
        valid: false,
        error: 'Cannot use this system directory as a workspace location',
      });

      await expect(validateBrowsableWorkspacePath('/etc')).resolves.toEqual({
        valid: false,
        error: 'Cannot browse this system directory',
      });
    });
  });

  it('accepts safe paths and resolves through existing real ancestors', async () => {
    await withServerTestEnv(async ({ tempDir, importServerModule }) => {
      const { validateWorkspacePath } = await importServerModule('../../server/routes/projects.js');

      const existingRoot = path.join(tempDir, 'parent');
      const requestedPath = path.join(existingRoot, 'child', 'nested');
      await fs.mkdir(existingRoot, { recursive: true });

      await expect(validateWorkspacePath(requestedPath)).resolves.toEqual({
        valid: true,
        resolvedPath: requestedPath,
      });
    });
  });
});
