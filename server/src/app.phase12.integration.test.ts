import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from './app.js';
import { config } from './config.js';
import { ensureDefaultAdmin } from './database/bootstrap.js';
import { database } from './database/client.js';
import { migrateDatabase } from './database/migrate.js';
import { chats, providers, users } from './database/schema.js';

const servers: Server[] = [];
let token = '';
let adminId = '';

async function mockProvider(handler: (path: string, body: string) => { status: number; body: unknown; contentType?: string }): Promise<string> {
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const result = handler(req.url ?? '/', body);
      res.statusCode = result.status;
      res.setHeader('content-type', result.contentType ?? 'application/json');
      res.setHeader('x-request-id', 'upstream-test-request');
      res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/v1`;
}

beforeAll(async () => {
  await migrateDatabase();
  await ensureDefaultAdmin();
  const admin = await database.select({ id: users.id }).from(users).where(eq(users.email, config.defaultAdminEmail)).limit(1);
  adminId = admin[0]!.id;
  const response = await request(createApp()).post('/api/auth/login').send({
    email: config.defaultAdminEmail,
    password: config.defaultAdminPassword
  });
  expect(response.status).toBe(200);
  token = response.body.accessToken as string;
});

beforeEach(async () => {
  await database.delete(chats).where(eq(chats.userId, adminId));
  await database.delete(providers).where(eq(providers.userId, adminId));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

afterAll(async () => {
  await database.delete(chats).where(eq(chats.userId, adminId));
  await database.delete(providers).where(eq(providers.userId, adminId));
});

function authenticated(app = createApp()) {
  return {
    get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string) => request(app).post(path).set('Authorization', `Bearer ${token}`),
    patch: (path: string) => request(app).patch(path).set('Authorization', `Bearer ${token}`),
    delete: (path: string) => request(app).delete(path).set('Authorization', `Bearer ${token}`)
  };
}

describe('health and authentication', () => {
  it('reports liveness separately from database readiness', async () => {
    const app = createApp();
    const health = await request(app).get('/api/health');
    const ready = await request(app).get('/api/ready');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, status: 'alive' });
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ ready: true, database: true });
  });

  it('returns the authenticated user without exposing tokens', async () => {
    const response = await authenticated().get('/api/auth/me');
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(config.defaultAdminEmail);
    expect(JSON.stringify(response.body)).not.toContain(config.jwtSecret);
  });
});

describe('provider API lifecycle', () => {
  it('normalizes URLs without duplicating version or endpoint paths', async () => {
    const response = await authenticated().post('/api/providers/normalize-url').send({
      type: 'custom',
      baseUrl: 'https://api.example.com/openai/v1/chat/completions?secret=x#fragment'
    });
    expect(response.status).toBe(200);
    expect(response.body.normalizedBaseUrl).toBe('https://api.example.com/openai/v1');
    expect(response.body.resolvedChatUrl).toBe('https://api.example.com/openai/v1/chat/completions');
  });

  it('saves a draft, hides the key, discovers models, retests, and allows chat selection only after readiness', async () => {
    const baseUrl = await mockProvider((path, body) => {
      if (path === '/v1/models') return { status: 200, body: { data: [{ id: 'model-a' }, { id: 'model-b' }] } };
      if (path === '/v1/chat/completions') {
        const input = JSON.parse(body) as { model: string };
        return { status: 200, body: { model: input.model, choices: [{ message: { content: 'OK' } }] } };
      }
      return { status: 404, body: { error: { message: 'not found' } } };
    });
    const apiKey = 'sk-test-api-key-that-must-never-be-returned-123456';
    const draft = await authenticated().post('/api/providers').send({
      name: 'Local provider', type: 'ollama', apiKey, baseUrl, selectedModel: 'model-b'
    });
    expect(draft.status).toBe(201);
    expect(draft.body.provider.status).toBe('draft');
    expect(draft.body.provider.is_ready).toBe(false);
    expect(JSON.stringify(draft.body)).not.toContain(apiKey);

    const draftChat = await authenticated().post('/api/chats').send({
      title: 'Not ready', providerId: draft.body.provider.id, model: 'model-b', mode: 'chat'
    });
    expect(draftChat.status).toBe(201);
    const rejected = await authenticated().post(`/api/chats/${draftChat.body.id}/messages`).send({ content: 'hello' });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('provider_not_ready');

    const discovery = await authenticated().get(`/api/providers/${draft.body.provider.id}/models?force=true`);
    expect(discovery.status).toBe(200);
    expect(discovery.body.models.map((model: { id: string }) => model.id)).toEqual(['model-a', 'model-b']);

    const retest = await authenticated().post(`/api/providers/${draft.body.provider.id}/retest`).send({});
    expect(retest.status).toBe(200);
    expect(retest.body.diagnostic).toMatchObject({ success: true, status: 'ready', modelAvailable: true });
    expect(retest.body.provider.status).toBe('ready');
    expect(JSON.stringify(retest.body)).not.toContain(apiKey);

    const list = await authenticated().get('/api/providers');
    expect(list.body.providers[0]).toMatchObject({ status: 'ready', is_ready: true, selected_model: 'model-b' });
  });

  it('allows manual model entry when model discovery returns 404 and inference succeeds', async () => {
    const baseUrl = await mockProvider((path) => {
      if (path === '/v1/models') return { status: 404, body: { error: { message: 'unsupported route' } } };
      if (path === '/v1/chat/completions') return { status: 200, body: { model: 'manual-model', choices: [{ message: { content: 'OK' } }] } };
      return { status: 404, body: {} };
    });
    const response = await authenticated().post('/api/providers/test').send({
      name: 'Manual', type: 'ollama', apiKey: '', baseUrl, selectedModel: 'manual-model'
    });
    expect(response.status).toBe(200);
    expect(response.body.diagnostic.status).toBe('ready');
    expect(response.body.discovery.status).toBe('unsupported');
  });

  it('classifies 503 no-channel errors as retryable model unavailability, not an invalid key', async () => {
    const baseUrl = await mockProvider((path) => {
      if (path === '/v1/models') return { status: 200, body: { data: [{ id: 'gpt-4.1-mini' }] } };
      if (path === '/v1/chat/completions') {
        return { status: 503, body: { error: { code: 'no_channel', message: 'No available channel for model gpt-4.1-mini under group default' } } };
      }
      return { status: 404, body: {} };
    });
    const response = await authenticated().post('/api/providers/test').send({
      name: 'Unavailable', type: 'ollama', apiKey: '', baseUrl, selectedModel: 'gpt-4.1-mini'
    });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('provider_model_unavailable');
    expect(response.body.details).toMatchObject({
      status: 'model_unavailable',
      providerReachable: true,
      modelAvailable: false,
      retryable: true
    });
    expect(response.body.details.keyValid).not.toBe(false);
    expect(response.body.details.userMessageAr).toContain('لا توجد قناة متاحة');
  });

  it('enforces ownership for provider mutation', async () => {
    const baseUrl = await mockProvider(() => ({ status: 200, body: { data: [] } }));
    const created = await authenticated().post('/api/providers').send({
      name: 'Owned', type: 'ollama', apiKey: '', baseUrl, selectedModel: 'm'
    });
    const strangerEmail = `stranger-${Date.now()}@example.com`;
    const createUser = await authenticated().post('/api/auth/create-user').send({
      email: strangerEmail, password: 'StrangerPassword123!', name: 'Stranger'
    });
    expect(createUser.status).toBe(201);
    const strangerLogin = await request(createApp()).post('/api/auth/login').send({ email: strangerEmail, password: 'StrangerPassword123!' });
    const strangerToken = strangerLogin.body.accessToken as string;
    const response = await request(createApp())
      .post(`/api/providers/${created.body.provider.id}/retest`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({});
    expect(response.status).toBe(404);
    await database.delete(users).where(eq(users.email, strangerEmail));
  });
});
