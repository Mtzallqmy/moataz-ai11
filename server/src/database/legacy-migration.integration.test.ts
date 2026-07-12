import path from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const rootUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const source = new URL(rootUrl);
const databaseName = `moataz_legacy_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/g, '');
const adminUrl = new URL(source.toString());
adminUrl.pathname = '/postgres';
const legacyUrl = new URL(source.toString());
legacyUrl.pathname = `/${databaseName}`;
let legacyPool: Pool | undefined;

beforeAll(async () => {
  const admin = new Pool({ connectionString: adminUrl.toString(), ssl: false });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await admin.end();
  legacyPool = new Pool({ connectionString: legacyUrl.toString(), ssl: false });
  await legacyPool!.query(`
    CREATE TABLE users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      name text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      is_active integer NOT NULL DEFAULT 1,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE providers (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      type text NOT NULL,
      base_url text,
      api_key_enc text NOT NULL,
      default_model text NOT NULL,
      validation_status text NOT NULL DEFAULT 'untested',
      validation_error_code text,
      validated_at timestamp,
      is_active integer NOT NULL DEFAULT 1,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE integrations (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type text NOT NULL,
      name text NOT NULL,
      token_enc text NOT NULL,
      meta text,
      validation_status text NOT NULL DEFAULT 'untested',
      validation_error_code text,
      validated_at timestamp,
      is_active integer NOT NULL DEFAULT 1,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE chats (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL,
      provider_id text REFERENCES providers(id) ON DELETE SET NULL,
      model text,
      mode text NOT NULL DEFAULT 'agent',
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE messages (
      id text PRIMARY KEY,
      chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      tool_calls text,
      idempotency_key text,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE agent_runs (
      id text PRIMARY KEY,
      chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      status text NOT NULL,
      log text NOT NULL DEFAULT '',
      error_code text,
      started_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at timestamp,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await legacyPool!.query(`
    INSERT INTO users(id,email,password_hash,name,role,is_active) VALUES ('u1','legacy@example.com','hash','Legacy','admin',1);
    INSERT INTO providers(id,user_id,name,type,base_url,api_key_enc,default_model,validation_status,is_active)
      VALUES ('p1','u1','Legacy Provider','openrouter','https://openrouter.ai/api/v1','ciphertext','model/a','verified',1);
    INSERT INTO integrations(id,user_id,type,name,token_enc,meta,validation_status,is_active)
      VALUES ('i1','u1','telegram','Legacy Bot','ciphertext','{"allowedChatIds":["123"]}','verified',1);
    INSERT INTO chats(id,user_id,title,provider_id,model,mode) VALUES ('c1','u1','Legacy Chat','p1','model/a','agent');
    INSERT INTO messages(id,chat_id,role,content,tool_calls,idempotency_key) VALUES
      ('m1','c1','user','hello','[]','legacy-key'),
      ('m2','c1','assistant','hi','[{"name":"read_file"}]','legacy-key');
    INSERT INTO agent_runs(id,chat_id,status,log) VALUES ('r1','c1','completed','{"legacy":true}');
  `);
});

afterAll(async () => {
  await legacyPool?.end();
  const admin = new Pool({ connectionString: adminUrl.toString(), ssl: false });
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end();
});

describe('legacy PostgreSQL migration', () => {
  it('preserves records while backfilling typed provider and JSONB fields', async () => {
    if (!legacyPool) throw new Error('legacy_pool_not_initialized');
    const db = drizzle(legacyPool);
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
    const provider = await legacyPool.query<{
      protocol: string;
      raw_base_url: string;
      normalized_base_url: string;
      selected_model: string;
      status: string;
      is_ready: boolean;
      is_active: boolean;
    }>(`SELECT protocol, raw_base_url, normalized_base_url, selected_model, status, is_ready, is_active FROM providers WHERE id='p1'`);
    expect(provider.rows[0]).toMatchObject({
      protocol: 'openai-compatible',
      raw_base_url: 'https://openrouter.ai/api/v1',
      normalized_base_url: 'https://openrouter.ai/api/v1',
      selected_model: 'model/a',
      status: 'ready',
      is_ready: true,
      is_active: true
    });
    const integration = await legacyPool.query<{ meta_json: unknown; is_active: boolean }>(`SELECT meta_json, is_active FROM integrations WHERE id='i1'`);
    expect(integration.rows[0]?.meta_json).toEqual({ allowedChatIds: ['123'] });
    expect(integration.rows[0]?.is_active).toBe(true);
    const message = await legacyPool.query<{ sequence: string; tool_calls_json: unknown }>(`SELECT sequence::text, tool_calls_json FROM messages WHERE id='m2'`);
    expect(Number(message.rows[0]?.sequence)).toBe(2);
    expect(message.rows[0]?.tool_calls_json).toEqual([{ name: 'read_file' }]);
    const run = await legacyPool.query<{ user_id: string; finished_at: string | null; summary: unknown }>(`SELECT user_id, finished_at::text, summary FROM agent_runs WHERE id='r1'`);
    expect(run.rows[0]?.user_id).toBe('u1');
    expect(run.rows[0]?.summary).toEqual({ legacy: true });
    expect(run.rows[0]?.finished_at).not.toBeNull();

    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
    expect((await legacyPool.query<{ count: number }>(`SELECT count(*)::int AS count FROM providers WHERE id='p1'`)).rows[0]!.count).toBe(1);
  });
});
