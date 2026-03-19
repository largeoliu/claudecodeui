import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { withServerTestEnv } from '../../helpers/server-test-env.js';

function createProtectedApp(authenticateToken) {
  const app = express();
  app.get('/protected', authenticateToken, (req, res) => {
    res.json({ user: req.user });
  });
  return app;
}

describe('auth middleware', () => {
  it('rejects missing or invalid bearer tokens', async () => {
    await withServerTestEnv(async ({ dbModule, importServerModule }) => {
      dbModule.userDb.createUser('alice', 'hash');
      const { authenticateToken } = await importServerModule('../../server/middleware/auth.js');
      const app = createProtectedApp(authenticateToken);

      const missingResponse = await request(app).get('/protected');
      expect(missingResponse.status).toBe(401);

      const invalidResponse = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer invalid-token');
      expect(invalidResponse.status).toBe(403);
    });
  });

  it('accepts bearer tokens, query-string tokens, and refreshes aging sessions', async () => {
    await withServerTestEnv(async ({ dbModule, importServerModule }) => {
      const user = dbModule.userDb.createUser('alice', 'hash');
      const { authenticateToken, generateToken } = await importServerModule('../../server/middleware/auth.js');
      const app = createProtectedApp(authenticateToken);

      const validToken = generateToken(user);
      const bearerResponse = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${validToken}`);

      expect(bearerResponse.status).toBe(200);
      expect(bearerResponse.body.user.username).toBe('alice');

      const queryResponse = await request(app).get(`/protected?token=${validToken}`);
      expect(queryResponse.status).toBe(200);
      expect(queryResponse.body.user.username).toBe('alice');

      const now = Math.floor(Date.now() / 1000);
      const oldToken = jwt.sign(
        {
          userId: user.id,
          username: user.username,
          iat: now - 5 * 24 * 60 * 60,
          exp: now + 2 * 24 * 60 * 60,
        },
        process.env.JWT_SECRET,
      );

      const refreshResponse = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${oldToken}`);

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.headers['x-refreshed-token']).toEqual(expect.any(String));
    });
  });

  it('validates API keys and WebSocket tokens', async () => {
    await withServerTestEnv(async ({ dbModule, importServerModule }) => {
      const user = dbModule.userDb.createUser('alice', 'hash');
      process.env.API_KEY = 'super-secret';
      const { authenticateWebSocket, generateToken, validateApiKey } = await importServerModule('../../server/middleware/auth.js');

      const apiKeyApp = express();
      apiKeyApp.get('/api-key-protected', validateApiKey, (_req, res) => {
        res.json({ ok: true });
      });

      const deniedResponse = await request(apiKeyApp).get('/api-key-protected');
      expect(deniedResponse.status).toBe(401);

      const allowedResponse = await request(apiKeyApp)
        .get('/api-key-protected')
        .set('x-api-key', 'super-secret');
      expect(allowedResponse.status).toBe(200);

      const token = generateToken(user);
      expect(authenticateWebSocket(token)).toEqual({ userId: user.id, username: 'alice' });
      expect(authenticateWebSocket('bad-token')).toBeNull();
    });
  });

  it('bypasses JWT checks in platform mode and injects the first user', async () => {
    await withServerTestEnv(async ({ dbModule, importServerModule }) => {
      dbModule.userDb.createUser('platform-user', 'hash');
      const { authenticateToken } = await importServerModule('../../server/middleware/auth.js');
      const app = createProtectedApp(authenticateToken);

      const response = await request(app).get('/protected');

      expect(response.status).toBe(200);
      expect(response.body.user.username).toBe('platform-user');
    }, { isPlatform: true });
  });
});
