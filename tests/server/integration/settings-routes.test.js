import request from 'supertest';
import { vi } from 'vitest';
import { createTestApp } from '../../helpers/create-test-app.js';
import { withServerTestEnv } from '../../helpers/server-test-env.js';

const serviceMocks = vi.hoisted(() => ({
  getPublicKey: vi.fn(() => 'public-vapid-key'),
  createNotificationEvent: vi.fn((event) => ({ id: 'event-1', ...event })),
  notifyUserIfEnabled: vi.fn(),
}));

vi.mock('../../../server/services/vapid-keys.js', () => ({
  getPublicKey: serviceMocks.getPublicKey,
}));

vi.mock('../../../server/services/notification-orchestrator.js', () => ({
  createNotificationEvent: serviceMocks.createNotificationEvent,
  notifyUserIfEnabled: serviceMocks.notifyUserIfEnabled,
}));

describe('settings routes', () => {
  beforeEach(() => {
    serviceMocks.getPublicKey.mockReturnValue('public-vapid-key');
    serviceMocks.createNotificationEvent.mockImplementation((event) => ({ id: 'event-1', ...event }));
    serviceMocks.notifyUserIfEnabled.mockReset();
  });

  it('manages API keys end to end', async () => {
    await withServerTestEnv(async ({ dbModule, importServerModule }) => {
      const user = dbModule.userDb.createUser('settings-user', 'hash');
      const { default: router } = await importServerModule('../../server/routes/settings.js');
      const app = createTestApp(router, { user });

      const emptyResponse = await request(app).get('/api-keys');
      expect(emptyResponse.body).toEqual({ apiKeys: [] });

      const invalidResponse = await request(app).post('/api-keys').send({ keyName: '   ' });
      expect(invalidResponse.status).toBe(400);

      const createResponse = await request(app).post('/api-keys').send({ keyName: 'Primary Key' });
      expect(createResponse.status).toBe(200);
      expect(createResponse.body).toEqual({
        success: true,
        apiKey: {
          id: 1,
          keyName: 'Primary Key',
          apiKey: expect.stringMatching(/^ck_[a-f0-9]{64}$/),
        },
      });

      const listResponse = await request(app).get('/api-keys');
      expect(listResponse.body.apiKeys).toHaveLength(1);
      expect(listResponse.body.apiKeys[0]).toMatchObject({
        id: 1,
        key_name: 'Primary Key',
        api_key: expect.stringMatching(/^.{10}\.\.\.$/),
        is_active: 1,
      });

      const toggleResponse = await request(app)
        .patch('/api-keys/1/toggle')
        .send({ isActive: false });
      expect(toggleResponse.body).toEqual({ success: true });

      const deleteResponse = await request(app).delete('/api-keys/1');
      expect(deleteResponse.body).toEqual({ success: true });
      expect((await request(app).get('/api-keys')).body.apiKeys).toEqual([]);
    });
  });

  it('manages generic credentials and supports filtering', async () => {
    await withServerTestEnv(async ({ dbModule, importServerModule }) => {
      const user = dbModule.userDb.createUser('settings-user', 'hash');
      const { default: router } = await importServerModule('../../server/routes/settings.js');
      const app = createTestApp(router, { user });

      const invalidResponse = await request(app).post('/credentials').send({ credentialName: '' });
      expect(invalidResponse.status).toBe(400);

      const createResponse = await request(app).post('/credentials').send({
        credentialName: 'GitHub Token',
        credentialType: 'github_token',
        credentialValue: 'ghp_secret',
        description: 'For repository access',
      });

      expect(createResponse.status).toBe(200);
      expect(createResponse.body).toEqual({
        success: true,
        credential: {
          id: 1,
          credentialName: 'GitHub Token',
          credentialType: 'github_token',
        },
      });

      const listResponse = await request(app).get('/credentials?type=github_token');
      expect(listResponse.body.credentials).toEqual([
        expect.objectContaining({
          id: 1,
          credential_name: 'GitHub Token',
          credential_type: 'github_token',
          description: 'For repository access',
          is_active: 1,
        }),
      ]);

      const toggleResponse = await request(app)
        .patch('/credentials/1/toggle')
        .send({ isActive: false });
      expect(toggleResponse.body).toEqual({ success: true });

      const deleteResponse = await request(app).delete('/credentials/1');
      expect(deleteResponse.body).toEqual({ success: true });
      expect((await request(app).get('/credentials')).body.credentials).toEqual([]);
    });
  });

  it('returns default notification preferences and persists updates', async () => {
    await withServerTestEnv(async ({ dbModule, importServerModule }) => {
      const user = dbModule.userDb.createUser('settings-user', 'hash');
      const { default: router } = await importServerModule('../../server/routes/settings.js');
      const app = createTestApp(router, { user });

      const defaultsResponse = await request(app).get('/notification-preferences');
      expect(defaultsResponse.body).toEqual({
        success: true,
        preferences: {
          channels: { inApp: false, webPush: false },
          events: { actionRequired: true, stop: true, error: true },
        },
      });

      const updateResponse = await request(app).put('/notification-preferences').send({
        channels: { inApp: true, webPush: true },
        events: { actionRequired: false, stop: true, error: false },
      });

      expect(updateResponse.body).toEqual({
        success: true,
        preferences: {
          channels: { inApp: true, webPush: true },
          events: { actionRequired: false, stop: true, error: false },
        },
      });
    });
  });

  it('manages push subscriptions and keeps preferences in sync', async () => {
    await withServerTestEnv(async ({ dbModule, importServerModule }) => {
      const user = dbModule.userDb.createUser('settings-user', 'hash');
      const { default: router } = await importServerModule('../../server/routes/settings.js');
      const app = createTestApp(router, { user });

      const publicKeyResponse = await request(app).get('/push/vapid-public-key');
      expect(publicKeyResponse.body).toEqual({ publicKey: 'public-vapid-key' });

      const invalidSubscribeResponse = await request(app).post('/push/subscribe').send({});
      expect(invalidSubscribeResponse.status).toBe(400);

      const subscribeResponse = await request(app).post('/push/subscribe').send({
        endpoint: 'https://push.example.com/subscriptions/1',
        keys: {
          p256dh: 'p-key',
          auth: 'auth-key',
        },
      });

      expect(subscribeResponse.body).toEqual({ success: true });
      expect(dbModule.pushSubscriptionsDb.getSubscriptions(user.id)).toEqual([
        {
          endpoint: 'https://push.example.com/subscriptions/1',
          keys_p256dh: 'p-key',
          keys_auth: 'auth-key',
        },
      ]);
      expect(dbModule.notificationPreferencesDb.getPreferences(user.id).channels.webPush).toBe(true);
      expect(serviceMocks.createNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'system',
        code: 'push.enabled',
      }));
      expect(serviceMocks.notifyUserIfEnabled).toHaveBeenCalledWith({
        userId: user.id,
        event: expect.objectContaining({ id: 'event-1' }),
      });

      const invalidUnsubscribeResponse = await request(app).post('/push/unsubscribe').send({});
      expect(invalidUnsubscribeResponse.status).toBe(400);

      const unsubscribeResponse = await request(app)
        .post('/push/unsubscribe')
        .send({ endpoint: 'https://push.example.com/subscriptions/1' });

      expect(unsubscribeResponse.body).toEqual({ success: true });
      expect(dbModule.pushSubscriptionsDb.getSubscriptions(user.id)).toEqual([]);
      expect(dbModule.notificationPreferencesDb.getPreferences(user.id).channels.webPush).toBe(false);
    });
  });
});
