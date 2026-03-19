import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';

const SERVER_ENV_KEYS = ['API_KEY', 'DATABASE_PATH', 'JWT_SECRET', 'NODE_ENV', 'VITE_IS_PLATFORM'];

export async function withServerTestEnv(run, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudecodeui-vitest-'));
  const previousEnv = Object.fromEntries(SERVER_ENV_KEYS.map((key) => [key, process.env[key]]));

  process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
  process.env.JWT_SECRET = options.jwtSecret || 'vitest-secret';
  process.env.NODE_ENV = 'test';
  process.env.VITE_IS_PLATFORM = options.isPlatform ? 'true' : 'false';

  vi.resetModules();

  const dbModule = await import(new URL('../../server/database/db.js', import.meta.url).href);
  await dbModule.initializeDatabase();

  try {
    return await run({
      tempDir,
      dbModule,
      importServerModule: (relativePath) => import(new URL(relativePath, import.meta.url).href),
    });
  } finally {
    try {
      dbModule.db.close();
    } catch {
      // Database may already be closed.
    }

    vi.resetModules();

    for (const key of SERVER_ENV_KEYS) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
