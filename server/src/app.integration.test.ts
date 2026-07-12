import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { close, cryptoId, get, migrate, run } from './db.js';
import { decrypt, encrypt } from './crypto.js';
import { signAccessToken } from './auth.js';
import { consumeTerminalTicket, issueTerminalTicket } from './ws-tickets.js';

const app = createApp();
let adminToken = '';
let adminId = '';
let unverifiedProviderId = '';
let naraProviderId = '';
const naraFixtureKey = 'sk-nry-local-fixture-7XqA';

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

  it('normalizes and stores NaraRouter safely without exposing its credential', async () => {
    const catalog = await request(app).get('/api/provider-catalog').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(catalog.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'nararouter',
        protocol: 'openai-compatible',
        defaultBaseUrl: 'https://router.bynara.id/v1'
      })
    ]));

    const normalized = await request(app)
      .post('/api/providers/normalize-url')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'nararouter', baseUrl: '  "https://router.bynara.id/v1/chat/completions/"  ' })
      .expect(200);
    expect(normalized.body).toMatchObject({
      normalizedBaseUrl: 'https://router.bynara.id/v1',
      resolvedModelsUrl: 'https://router.bynara.id/v1/models',
      resolvedChatUrl: 'https://router.bynara.id/v1/chat/completions'
    });

    const created = await request(app)
      .post('/api/providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'NaraRouter integration fixture',
        type: 'nararouter',
        protocol: 'openai-compatible',
        baseUrl: '  "https://router.bynara.id/v1/chat/completions/"  ',
        apiKey: `  "${naraFixtureKey}"  `,
        defaultModel: '',
        customHeaders: { 'x-title': 'Moataz integration test' },
        streamingEnabled: true
      })
      .expect(201);

    naraProviderId = created.body.provider.id as string;
    expect(created.body.provider).toMatchObject({
      type: 'nararouter',
      protocol: 'openai-compatible',
      base_url: 'https://router.bynara.id/v1',
      key_mask: '••••••••••••7XqA',
      credential_version: 1,
      validation_status: 'untested'
    });
    expect(JSON.stringify(created.body)).not.toContain(naraFixtureKey);

    const listed = await request(app).get('/api/providers').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const listedText = JSON.stringify(listed.body);
    expect(listedText).not.toContain(naraFixtureKey);
    expect(listedText).not.toContain('api_key_enc');
    expect(listed.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: naraProviderId, key_mask: '••••••••••••7XqA' })
    ]));

    const stored = await get<{ api_key_enc: string; custom_headers_enc: string | null }>(
      'SELECT api_key_enc, custom_headers_enc FROM providers WHERE id = ?',
      [naraProviderId]
    );
    expect(stored).toBeDefined();
    expect(stored!.api_key_enc).not.toContain(naraFixtureKey);
    expect(decrypt(stored!.api_key_enc)).toBe(naraFixtureKey);
    expect(stored!.custom_headers_enc).not.toContain('Moataz integration test');
  });

  it('retains a saved provider key when the edit field is blank and invalidates models only for credential changes', async () => {
    await run(
      `UPDATE providers SET validation_status = 'verified', validated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [naraProviderId]
    );
    await run(
      `INSERT INTO provider_models (provider_id, model_id, display_name) VALUES (?, ?, ?)`,
      [naraProviderId, 'actual/model-id', 'Fixture model']
    );

    const metadataOnly = await request(app)
      .patch(`/api/providers/${naraProviderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'NaraRouter renamed', apiKey: '' })
      .expect(200);
    expect(metadataOnly.body).toMatchObject({ credential_version: 1, validation_status: 'verified' });
    const retained = await get<{ api_key_enc: string }>('SELECT api_key_enc FROM providers WHERE id = ?', [naraProviderId]);
    expect(decrypt(retained!.api_key_enc)).toBe(naraFixtureKey);
    expect(await get('SELECT model_id FROM provider_models WHERE provider_id = ?', [naraProviderId])).toBeDefined();

    const changed = await request(app)
      .patch(`/api/providers/${naraProviderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ apiKey: 'rotated-fixture-key-Z9Y8' })
      .expect(200);
    expect(changed.body).toMatchObject({ credential_version: 2, validation_status: 'untested' });
    expect(await get('SELECT model_id FROM provider_models WHERE provider_id = ?', [naraProviderId])).toBeUndefined();
  });

  it('runs the full NaraRouter discovery, inference, SSE, persistence, and idempotency pipeline', async () => {
    const encoder = new TextEncoder();
    const observedAuthorizations: Array<string | null> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const outbound = input instanceof Request ? input : new Request(input, init);
      const url = outbound.url;
      const method = outbound.method.toUpperCase();
      observedAuthorizations.push(outbound.headers.get('authorization'));

      if (method === 'GET' && url === 'https://router.bynara.id/v1/models') {
        return new Response(JSON.stringify({ data: [{ id: 'nara/model-real', owned_by: 'nararouter' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-request-id': 'nara-models-request' }
        });
      }

      if (method === 'POST' && url === 'https://router.bynara.id/v1/chat/completions') {
        const rawBody = await outbound.clone().text();
        const body = JSON.parse(rawBody || '{}') as { stream?: boolean; model?: string };
        expect(body.model).toBe('nara/model-real');
        if (body.stream) {
          const payloads = [
            { id: 'chunk-1', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: { content: 'Hello ' }, finish_reason: null }] },
            { id: 'chunk-2', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: { content: 'from Nara' }, finish_reason: null }] },
            { id: 'chunk-3', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
          ];
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              for (const payload of payloads) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            }
          });
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream', 'x-request-id': 'nara-stream-request' }
          });
        }
        return new Response(JSON.stringify({
          id: 'completion-1',
          object: 'chat.completion',
          model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }
        }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'nara-chat-request' } });
      }

      return new Response(JSON.stringify({ error: { message: `Unexpected fixture URL: ${method} ${url}` } }), {
        status: 500, headers: { 'content-type': 'application/json' }
      });
    });
    const dnsLookup = vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const retested = await request(app)
        .post(`/api/providers/${naraProviderId}/retest`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(200);
      expect(observedAuthorizations).not.toHaveLength(0);
      expect(observedAuthorizations.every((value) => value === 'Bearer rotated-fixture-key-Z9Y8')).toBe(true);
      expect(retested.body).toMatchObject({ ok: true, model: 'nara/model-real', validation_status: 'verified' });
      expect(retested.body.models).toContain('nara/model-real');

      const chat = await request(app)
        .post('/api/chats')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ providerId: naraProviderId, model: 'nara/model-real', mode: 'chat' })
        .expect(201);
      const chatId = chat.body.id as string;
      const idempotencyKey = `nara-${crypto.randomUUID()}`;
      const streamed = await request(app)
        .post(`/api/chats/${chatId}/messages/stream`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          providerId: naraProviderId,
          model: 'nara/model-real',
          content: 'Say hello',
          stream: true
        })
        .expect(200);
      expect(streamed.headers['content-type']).toMatch(/text\/event-stream/);
      expect(streamed.text).toContain('event: delta');
      expect(streamed.text).toContain('Hello from Nara');
      expect(streamed.text).toContain('event: completed');

      const replay = await request(app)
        .post(`/api/chats/${chatId}/messages/stream`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ providerId: naraProviderId, model: 'nara/model-real', content: 'Say hello', stream: true })
        .expect(200);
      expect(replay.text).toContain('"replayed":true');

      const messages = await request(app)
        .get(`/api/chats/${chatId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(messages.body.messages.filter((message: { role: string }) => message.role === 'user')).toHaveLength(1);
      expect(messages.body.messages.filter((message: { role: string }) => message.role === 'assistant')).toHaveLength(1);
      expect(messages.body.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'Hello from Nara', status: 'completed' })
      ]));

      const requestLog = await get<{ base_url_host: string; endpoint_path: string; model: string; stream: number }>(
        `SELECT base_url_host, endpoint_path, model, stream FROM provider_request_logs
         WHERE provider_id = ? AND stream = 1 ORDER BY created_at DESC LIMIT 1`,
        [naraProviderId]
      );
      expect(requestLog).toMatchObject({
        base_url_host: 'router.bynara.id',
        endpoint_path: '/v1/chat/completions',
        model: 'nara/model-real',
        stream: 1
      });
      expect(JSON.stringify(requestLog)).not.toContain('rotated-fixture-key-Z9Y8');
    } finally {
      dnsLookup.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('rejects custom headers that could replace provider authentication', async () => {
    const response = await request(app)
      .post('/api/providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Unsafe custom provider',
        type: 'custom',
        protocol: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'fixture-key',
        customHeaders: { Authorization: 'Bearer attacker-controlled' }
      })
      .expect(422);
    expect(response.body.error).toBe('provider_custom_header_forbidden');
    expect(JSON.stringify(response.body)).not.toContain('attacker-controlled');
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
