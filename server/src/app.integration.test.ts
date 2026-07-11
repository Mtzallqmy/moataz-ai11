import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { close, cryptoId, migrate, run } from './db.js';
import { encrypt } from './crypto.js';
import { signAccessToken } from './auth.js';
import { consumeTerminalTicket, issueTerminalTicket } from './ws-tickets.js';

const app = createApp();
let adminToken = '';
let adminId = '';
let unverifiedProviderId = '';

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await close();
});

describe('phase 1 HTTP integration', () => {
  it('reports health and readiness', async () => {
    await request(app).get('/api/health').expect(200, { ok: true, status: 'alive' });
    const ready = await request(app).get('/api/ready').expect(200);
    expect(ready.body.ready).toBe(true);
  });

  it('uses a generic login failure and accepts normalized email', async () => {
    const bad = await request(app).post('/api/auth/login').send({ email: 'missing@example.com', password: 'WrongPassword!' }).expect(401);
    expect(bad.body).toEqual({ error: 'bad_credentials' });

    const good = await request(app).post('/api/auth/login').send({ email: '  ADMIN@EXAMPLE.COM ', password: 'IntegrationPassword123!' }).expect(200);
    expect(good.body.accessToken).toEqual(expect.any(String));
    adminToken = good.body.accessToken as string;
    adminId = good.body.user.id as string;
  });

  it('returns the current user from /api/auth/me', async () => {
    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(response.body.user.email).toBe('admin@example.com');
    expect(response.body.user.role).toBe('admin');
  });

  it('rotates a refresh token stored in an HttpOnly cookie', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: 'admin@example.com', password: 'IntegrationPassword123!' }).expect(200);
    expect(login.headers['set-cookie']?.[0]).toContain('HttpOnly');
    const refreshed = await agent.post('/api/auth/refresh').send({}).expect(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
  });

  it('rejects an inactive user even with a valid access token', async () => {
    const id = cryptoId();
    const hash = await bcrypt.hash('InactivePassword123!', 4);
    await run('INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, ?, ?)', [id, 'inactive@example.com', hash, 'Inactive', 'user', 0]);
    const token = signAccessToken({ id, email: 'inactive@example.com', name: 'Inactive', role: 'user', isActive: true });
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401, { error: 'unauthorized' });
  });

  it('denies terminal tickets to non-admin users and reports unavailable shell to admins', async () => {
    const id = cryptoId();
    const hash = await bcrypt.hash('NormalUserPassword123!', 4);
    await run('INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, ?, ?)', [id, 'user@example.com', hash, 'User', 'user', 1]);
    const token = signAccessToken({ id, email: 'user@example.com', name: 'User', role: 'user', isActive: true });
    await request(app).post('/api/auth/ws-ticket').set('Authorization', `Bearer ${token}`).send({}).expect(403, { error: 'forbidden' });
    const adminResponse = await request(app).post('/api/auth/ws-ticket').set('Authorization', `Bearer ${adminToken}`).send({}).expect(503);
    expect(adminResponse.body.error).toBe('shell_unavailable');
  });

  it('consumes WebSocket tickets once and rejects expired tickets', async () => {
    const issued = await issueTerminalTicket(adminId);
    expect((await consumeTerminalTicket(issued.ticket))?.id).toBe(adminId);
    expect(await consumeTerminalTicket(issued.ticket)).toBeUndefined();

    const expired = await issueTerminalTicket(adminId);
    await run('UPDATE websocket_tickets SET expires_at = ? WHERE token_hash = ?', [new Date(0).toISOString(), crypto.createHash('sha256').update(expired.ticket).digest('hex')]);
    expect(await consumeTerminalTicket(expired.ticket)).toBeUndefined();
  });


  it('exposes provider presets without exposing credentials', async () => {
    const response = await request(app).get('/api/provider-catalog').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(response.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'nvidia', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1' }),
      expect.objectContaining({ id: 'huggingface', defaultBaseUrl: 'https://router.huggingface.co/v1' }),
      expect.objectContaining({ id: 'custom', baseUrlRequired: true })
    ]));
  });

  it('saves provider configuration without forcing a paid upstream request', async () => {
    const response = await request(app)
      .post('/api/providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Unverified OpenRouter',
        type: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'not-a-real-key-but-saveable',
        defaultModel: 'openai/gpt-5'
      })
      .expect(201);
    expect(response.body.provider.validation_status).toBe('untested');
    unverifiedProviderId = response.body.provider.id as string;
    const listed = await request(app).get('/api/providers').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(listed.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: response.body.provider.id, validation_status: 'untested' })
    ]));
  });

  it('saves integrations without an upstream call and marks them untested', async () => {
    const response = await request(app)
      .post('/api/integrations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Telegram staging bot',
        type: 'telegram',
        token: '123456789:abcdefghijklmnopqrstuvwxyz_ABC123',
        meta: { allowedChatIds: [], allowAllChats: false }
      })
      .expect(201);
    expect(response.body.integration.validation_status).toBe('untested');
    expect(response.body.integration.meta.allowedChatIds).toEqual([]);
    expect(response.body.integration.meta.allowAllChats).toBe(false);
  });

  it('blocks chat execution until the selected provider is verified', async () => {
    const created = await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: unverifiedProviderId, mode: 'chat' })
      .expect(201);
    const response = await request(app)
      .post(`/api/chats/${created.body.id as string}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ content: 'hello' })
      .expect(409);
    expect(response.body.error).toBe('provider_not_verified');
  });

  it('prevents cross-user provider and chat access', async () => {
    const otherUserId = cryptoId();
    const hash = await bcrypt.hash('OtherUserPassword123!', 4);
    await run('INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, ?, ?)', [otherUserId, 'other@example.com', hash, 'Other', 'user', 1]);
    const providerId = cryptoId();
    await run('INSERT INTO providers (id, user_id, name, type, api_key_enc, default_model) VALUES (?, ?, ?, ?, ?, ?)', [providerId, otherUserId, 'Other provider', 'openai', encrypt('test-key'), 'test-model']);
    const invalidProvider = await request(app).post('/api/chats').set('Authorization', `Bearer ${adminToken}`).send({ providerId, mode: 'chat' }).expect(404);
    expect(invalidProvider.body.error).toBe('provider_not_found');

    const chatId = cryptoId();
    await run('INSERT INTO chats (id, user_id, title, mode) VALUES (?, ?, ?, ?)', [chatId, otherUserId, 'Private', 'chat']);
    await request(app).get(`/api/chats/${chatId}/messages`).set('Authorization', `Bearer ${adminToken}`).expect(404);
  });

  it('rejects empty messages before starting an agent run', async () => {
    const created = await request(app).post('/api/chats').set('Authorization', `Bearer ${adminToken}`).send({ mode: 'chat' }).expect(201);
    const response = await request(app).post(`/api/chats/${created.body.id as string}/messages`).set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', crypto.randomUUID()).send({ content: '   ' }).expect(400);
    expect(response.body.error).toBe('invalid_request');
  });

  it('creates files through the protected tool API and rejects traversal', async () => {
    const created = await request(app).post('/api/tools/run').set('Authorization', `Bearer ${adminToken}`).send({ name: 'write_file', args: { path: 'notes/test.txt', content: 'hello' } }).expect(200);
    expect(created.body.result.written).toBe(true);
    const read = await request(app).post('/api/tools/run').set('Authorization', `Bearer ${adminToken}`).send({ name: 'read_file', args: { path: 'notes/test.txt' } }).expect(200);
    expect(read.body.result.content).toBe('hello');
    const rejected = await request(app).post('/api/tools/run').set('Authorization', `Bearer ${adminToken}`).send({ name: 'write_file', args: { path: '../escape.txt', content: 'x' } }).expect(400);
    expect(rejected.body.error).toBe('path_traversal');
  });

  it('returns JSON for unknown API routes instead of SPA HTML', async () => {
    const response = await request(app).get('/api/does-not-exist').set('Accept', 'text/html').expect(404);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({ error: 'api_not_found' });
  });
});
