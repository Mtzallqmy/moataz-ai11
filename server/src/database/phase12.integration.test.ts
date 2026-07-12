import { Pool } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { encrypt } from '../crypto.js';
import { agentRuns, agentSteps, providers, toolExecutions, users } from './schema.js';
import { database, pool } from './client.js';
import { cryptoId, sha256 } from './ids.js';
import { migrateDatabase, migrationStatus } from './migrate.js';
import { agentRunsRepository } from '../repositories/agent-runs.repository.js';
import { chatsRepository } from '../repositories/chats.repository.js';
import { messagesRepository } from '../repositories/messages.repository.js';
import { providersRepository } from '../repositories/providers.repository.js';
import { sessionsRepository } from '../repositories/sessions.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { websocketTicketsRepository } from '../repositories/websocket-tickets.repository.js';

const createdUsers = new Set<string>();

async function createUser(role: 'admin' | 'user' = 'user') {
  const id = cryptoId();
  createdUsers.add(id);
  return usersRepository.create({
    id,
    email: `${id}@example.com`,
    passwordHash: 'test-password-hash',
    name: 'Database Test',
    role,
    isActive: true
  });
}

beforeAll(async () => {
  await migrateDatabase();
});

afterEach(async () => {
  for (const id of createdUsers) {
    await database.delete(users).where(eq(users.id, id));
  }
  createdUsers.clear();
});

describe('Drizzle PostgreSQL migration lifecycle', () => {
  it('applies migrations to an existing database and remains idempotent', async () => {
    await migrateDatabase();
    await migrateDatabase();
    const status = await migrationStatus();
    expect(status.ready).toBe(true);
    expect(status.applied.length).toBeGreaterThan(0);
  });

  it('contains the required ownership and performance indexes', async () => {
    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
    );
    const indexes = new Set(result.rows.map((row) => row.indexname));
    for (const name of [
      'providers_user_ready_idx',
      'messages_chat_sequence_unique',
      'messages_chat_idempotency_role_unique',
      'agent_runs_one_running_unique',
      'refresh_tokens_user_expiry_idx',
      'websocket_tickets_hash_unique'
    ]) {
      expect(indexes.has(name)).toBe(true);
    }
  });
});

describe('typed repositories and ownership', () => {
  it('creates users and stores only hashed refresh tokens', async () => {
    const user = await createUser();
    const raw = 'refresh-secret-that-must-not-be-stored';
    const tokenHash = sha256(raw);
    await sessionsRepository.create({
      id: cryptoId(),
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      userAgent: 'vitest',
      ipHash: sha256('127.0.0.1')
    });
    const found = await sessionsRepository.findValidByHash(tokenHash);
    expect(found?.id).toBe(user.id);
    expect(await sessionsRepository.findValidByHash(raw)).toBeUndefined();
    await sessionsRepository.revokeAll(user.id);
    expect(await sessionsRepository.findValidByHash(tokenHash)).toBeUndefined();
  });

  it('enforces provider ownership and stores discovered models as JSONB', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const provider = await providersRepository.createDraft({
      id: cryptoId(),
      userId: owner.id,
      name: 'Mock Provider',
      providerType: 'custom',
      protocol: 'openai-compatible',
      rawBaseUrl: 'https://api.example.com/v1',
      normalizedBaseUrl: 'https://api.example.com/v1',
      encryptedApiKey: encrypt('sk-test-provider-secret-abcdefghijklmnopqrstuvwxyz'),
      selectedModel: 'model-a',
      capabilities: { modelDiscovery: true, streaming: true, tools: true, vision: null, embeddings: null, responsesApi: null }
    });
    expect(await providersRepository.findOwned(stranger.id, provider.id)).toBeUndefined();
    await providersRepository.replaceDiscoveredModels(owner.id, provider.id, [{ id: 'model-a', contextLength: 8192 }], new Date(Date.now() + 60_000).toISOString());
    const reloaded = await providersRepository.findOwned(owner.id, provider.id);
    expect(reloaded?.discovered_models).toEqual([{ id: 'model-a', contextLength: 8192 }]);
  });

  it('never exposes a non-ready provider through the ready query', async () => {
    const user = await createUser();
    const draft = await providersRepository.createDraft({
      id: cryptoId(), userId: user.id, name: 'Draft', providerType: 'custom', protocol: 'openai-compatible',
      rawBaseUrl: 'https://api.example.com/v1', normalizedBaseUrl: 'https://api.example.com/v1',
      encryptedApiKey: encrypt('sk-test-draft-secret-abcdefghijklmnopqrstuvwxyz'), selectedModel: 'm',
      capabilities: { modelDiscovery: true, streaming: true, tools: true, vision: null, embeddings: null, responsesApi: null }
    });
    expect((await providersRepository.listReadyForUser(user.id)).map((item) => item.id)).not.toContain(draft.id);
    await providersRepository.applyDiagnostic(user.id, draft.id, {
      success: true,
      status: 'ready',
      keyValid: true,
      providerReachable: true,
      modelAvailable: true,
      retryable: false,
      message: 'OK',
      userMessageAr: 'جاهز',
      userMessageEn: 'Ready',
      testedModel: 'm'
    }, { selectedModel: 'm' });
    expect((await providersRepository.listReadyForUser(user.id)).map((item) => item.id)).toContain(draft.id);
  });
});

describe('chat, message, agent run, and transaction integrity', () => {
  it('orders messages, rejects duplicate idempotency keys, and rolls back failed transactions', async () => {
    const user = await createUser();
    const chat = await chatsRepository.create({
      id: cryptoId(), userId: user.id, title: 'Test chat', providerId: null, model: null, mode: 'agent'
    });
    const key = `key-${cryptoId()}`;
    const first = await messagesRepository.insert({
      id: cryptoId(), chatId: chat.id, userId: user.id, role: 'user', content: 'hello', idempotencyKey: key
    });
    expect(first.sequence).toBe(1);
    await expect(messagesRepository.insert({
      id: cryptoId(), chatId: chat.id, userId: user.id, role: 'user', content: 'duplicate', idempotencyKey: key
    })).rejects.toBeDefined();
    expect((await messagesRepository.listForChat(chat.id)).map((message) => message.content)).toEqual(['hello']);

    const rollbackId = cryptoId();
    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({
        id: rollbackId,
        email: `${rollbackId}@example.com`,
        passwordHash: 'x',
        name: 'Rollback',
        role: 'user',
        isActive: true
      });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await usersRepository.findById(rollbackId)).toBeUndefined();
  });

  it('persists structured agent steps and tool executions and cascades them with the user', async () => {
    const user = await createUser();
    const chat = await chatsRepository.create({ id: cryptoId(), userId: user.id, title: 'Agent', providerId: null, model: null, mode: 'agent' });
    const runId = cryptoId();
    const messageId = cryptoId();
    await agentRunsRepository.begin({
      runId,
      userId: user.id,
      chatId: chat.id,
      providerId: null,
      model: null,
      userMessage: { id: messageId, content: 'run', idempotencyKey: `run-${cryptoId()}` },
      attachmentIds: []
    });
    const stepId = cryptoId();
    const toolId = cryptoId();
    await agentRunsRepository.createStep({ id: stepId, agentRunId: runId, stepNumber: 1, type: 'model', status: 'running' });
    await agentRunsRepository.createToolExecution({ id: toolId, agentRunId: runId, agentStepId: stepId, toolName: 'read_file', status: 'running', arguments: { path: 'README.md' } });
    await agentRunsRepository.finishToolExecution({ id: toolId, status: 'succeeded', resultMetadata: { type: 'object' }, durationMs: 4 });
    await agentRunsRepository.finishStep({ id: stepId, status: 'completed', outputMetadata: { toolCalls: 1 }, durationMs: 6 });
    await agentRunsRepository.complete({
      runId,
      userId: user.id,
      assistantMessage: { id: cryptoId(), chatId: chat.id, content: 'done', toolCalls: [], idempotencyKey: `answer-${cryptoId()}` },
      summary: { steps: 1 }
    });
    expect((await database.select().from(agentSteps).where(eq(agentSteps.agentRunId, runId))).length).toBe(1);
    expect((await database.select().from(toolExecutions).where(eq(toolExecutions.agentRunId, runId))).length).toBe(1);
    await database.delete(users).where(eq(users.id, user.id));
    createdUsers.delete(user.id);
    expect((await database.select().from(agentRuns).where(eq(agentRuns.id, runId))).length).toBe(0);
  });
});

describe('websocket ticket, timeout, and shutdown behavior', () => {
  it('consumes a websocket ticket only once', async () => {
    const user = await createUser('admin');
    const raw = `ticket-${cryptoId()}`;
    await websocketTicketsRepository.create({
      id: cryptoId(), tokenHash: sha256(raw), userId: user.id, purpose: 'terminal',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    expect((await websocketTicketsRepository.consume(sha256(raw), 'terminal'))?.id).toBe(user.id);
    expect(await websocketTicketsRepository.consume(sha256(raw), 'terminal')).toBeUndefined();
  });

  it('applies a statement timeout and can close an independent pool gracefully', async () => {
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    expect(connectionString).toBeTruthy();
    const isolated = new Pool({ connectionString, ssl: false, max: 1, statement_timeout: 50, query_timeout: 100 });
    await expect(isolated.query('SELECT pg_sleep(0.2)')).rejects.toBeDefined();
    await isolated.end();
    await expect(isolated.query('SELECT 1')).rejects.toBeDefined();
  });

  it('reports connection failures without echoing credentials', async () => {
    const secret = 'do-not-leak-database-password';
    const failing = new Pool({
      connectionString: `postgresql://postgres:${secret}@127.0.0.1:1/missing`,
      connectionTimeoutMillis: 100
    });
    let text = '';
    try { await failing.query('SELECT 1'); } catch (error) { text = String(error); }
    await failing.end();
    expect(text).not.toContain(secret);
  });
});
