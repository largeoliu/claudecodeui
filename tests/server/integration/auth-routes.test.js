import express from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import { withServerTestEnv } from '../../helpers/server-test-env.js';

const bcryptMocks = vi.hoisted(() => ({
  hash: vi.fn(async (value) => `bcrypt:${value}`),
  compare: vi.fn(async (value, hash) => hash === `bcrypt:${value}`),
}));

vi.mock('bcrypt', () => ({
  default: bcryptMocks,
  hash: bcryptMocks.hash,
  compare: bcryptMocks.compare,
}));

function createAuthApp(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe('auth routes', () => {
  beforeEach(() => {
    bcryptMocks.hash.mockImplementation(async (value) => `bcrypt:${value}`);
    bcryptMocks.compare.mockImplementation(async (value, hash) => hash === `bcrypt:${value}`);
  });

  it('reports setup is required before the first user exists', async () => {
    await withServerTestEnv(async ({ importServerModule }) => {
      const { default: router } = await importServerModule('../../server/routes/auth.js');
      const response = await request(createAuthApp(router)).get('/status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ needsSetup: true, isAuthenticated: false });
    });
  });

  it('registers the first user and blocks duplicate setup attempts', async () => {
    await withServerTestEnv(async ({ importServerModule }) => {
      const { default: router } = await importServerModule('../../server/routes/auth.js');
      const app = createAuthApp(router);

      const registerResponse = await request(app)
        .post('/register')
        .send({ username: 'alice', password: 'hashed-password' });

      expect(registerResponse.status).toBe(200);
      expect(registerResponse.body.success).toBe(true);
      expect(registerResponse.body.user).toEqual({ id: 1, username: 'alice' });
      expect(registerResponse.body.token).toEqual(expect.any(String));
      expect(bcryptMocks.hash).toHaveBeenCalledWith('hashed-password', 12);

      const statusResponse = await request(app).get('/status');
      expect(statusResponse.body.needsSetup).toBe(false);

      const duplicateResponse = await request(app)
        .post('/register')
        .send({ username: 'bob', password: 'another-password' });

      expect(duplicateResponse.status).toBe(403);
      expect(duplicateResponse.body).toEqual({
        error: 'User already exists. This is a single-user system.',
      });
    });
  });

  it('validates registration payloads', async () => {
    await withServerTestEnv(async ({ importServerModule }) => {
      const { default: router } = await importServerModule('../../server/routes/auth.js');
      const app = createAuthApp(router);

      const missingResponse = await request(app).post('/register').send({ username: '', password: '' });
      expect(missingResponse.status).toBe(400);
      expect(missingResponse.body.error).toContain('required');

      const shortResponse = await request(app)
        .post('/register')
        .send({ username: 'ab', password: '12345' });

      expect(shortResponse.status).toBe(400);
      expect(shortResponse.body.error).toContain('at least');
    });
  });

  it('authenticates valid logins and rejects invalid credentials', async () => {
    await withServerTestEnv(async ({ importServerModule }) => {
      const { default: router } = await importServerModule('../../server/routes/auth.js');
      const app = createAuthApp(router);

      await request(app).post('/register').send({ username: 'alice', password: 'hashed-password' });

      const invalidUserResponse = await request(app)
        .post('/login')
        .send({ username: 'missing', password: 'hashed-password' });
      expect(invalidUserResponse.status).toBe(401);

      const invalidPasswordResponse = await request(app)
        .post('/login')
        .send({ username: 'alice', password: 'wrong-password' });
      expect(invalidPasswordResponse.status).toBe(401);

      const loginResponse = await request(app)
        .post('/login')
        .send({ username: 'alice', password: 'hashed-password' });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.user).toEqual({ id: 1, username: 'alice' });
      expect(loginResponse.body.token).toEqual(expect.any(String));
      expect(bcryptMocks.compare).toHaveBeenCalledWith('hashed-password', 'bcrypt:hashed-password');
    });
  });

  it('serves protected auth endpoints when a valid token is provided', async () => {
    await withServerTestEnv(async ({ importServerModule }) => {
      const { default: router } = await importServerModule('../../server/routes/auth.js');
      const app = createAuthApp(router);

      const registerResponse = await request(app)
        .post('/register')
        .send({ username: 'alice', password: 'hashed-password' });
      const token = registerResponse.body.token;

      const userResponse = await request(app)
        .get('/user')
        .set('Authorization', `Bearer ${token}`);

      expect(userResponse.status).toBe(200);
      expect(userResponse.body).toEqual({
        user: {
          id: 1,
          username: 'alice',
          created_at: expect.any(String),
          last_login: expect.any(String),
        },
      });

      const logoutResponse = await request(app)
        .post('/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(logoutResponse.status).toBe(200);
      expect(logoutResponse.body).toEqual({
        success: true,
        message: 'Logged out successfully',
      });
    });
  });
});
