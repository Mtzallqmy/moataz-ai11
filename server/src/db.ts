import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { logger } from './logger.js';

export type DbRow = Record<string, unknown>;
export type SqlParams = readonly unknown[];
export type SqlOperation = { sql: string; params?: SqlParams };

const isPostgres = /^postgres(?:ql)?:/i.test(config.databaseUrl);
let sqliteDb: Database.Database | undefined;
let pgPool: Pool | undefined;
let migrated = false;

const dbPath = config.databaseUrl.startsWith('file:')
  ? config.databaseUrl.slice('file:'.length)
  : './data/moataz.db';

function postgresSsl(): false | { rejectUnauthorized: boolean } | undefined {
  if (!isPostgres || config.databaseSslMode === 'disable') return undefined;
  if (config.databaseSslMode === 'require') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

if (isPostgres) {
  pgPool = new Pool({
    connectionString: config.databaseUrl,
    ssl: postgresSsl(),
    max: 10,
    min: 0,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
    application_name: 'moataz-ai'
  });
  pgPool.on('error', (error) => logger.error('database_pool_error', { error: error.message }));
} else {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.pragma('busy_timeout = 5000');
}

function transform(sql: string): string {
  if (!isPostgres) return sql;
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function pgQuery<T extends DbRow>(client: Pool | PoolClient, sql: string, params: SqlParams): Promise<T[]> {
  const result: QueryResult<T> = await client.query(transform(sql), [...params]);
  return result.rows;
}

export async function query<T extends DbRow = DbRow>(sql: string, params: SqlParams = []): Promise<T[]> {
  if (isPostgres) return pgQuery<T>(pgPool!, sql, params);
  return sqliteDb!.prepare(sql).all(...params) as T[];
}

export async function get<T extends DbRow = DbRow>(sql: string, params: SqlParams = []): Promise<T | undefined> {
  if (isPostgres) {
    const rows = await pgQuery<T>(pgPool!, sql, params);
    return rows[0];
  }
  return sqliteDb!.prepare(sql).get(...params) as T | undefined;
}

export async function run(sql: string, params: SqlParams = []): Promise<unknown> {
  if (isPostgres) return pgPool!.query(transform(sql), [...params]);
  return sqliteDb!.prepare(sql).run(...params);
}

export async function transaction(operations: readonly SqlOperation[]): Promise<void> {
  if (isPostgres) {
    const client = await pgPool!.connect();
    try {
      await client.query('BEGIN');
      for (const operation of operations) {
        await client.query(transform(operation.sql), [...(operation.params ?? [])]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  const execute = sqliteDb!.transaction((ops: readonly SqlOperation[]) => {
    for (const operation of ops) {
      sqliteDb!.prepare(operation.sql).run(...(operation.params ?? []));
    }
  });
  execute(operations);
}

async function addColumn(table: string, definition: string): Promise<void> {
  try {
    await run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('duplicate column') || message.includes('already exists')) return;
    throw error;
  }
}

const baseStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    base_url TEXT,
    raw_base_url TEXT,
    normalized_base_url TEXT,
    protocol TEXT,
    api_key_enc TEXT NOT NULL,
    encryption_version INTEGER NOT NULL DEFAULT 1,
    default_model TEXT NOT NULL,
    discovered_models TEXT,
    capabilities TEXT,
    validation_status TEXT NOT NULL DEFAULT 'draft',
    validation_error_code TEXT,
    last_check_message TEXT,
    validated_at TIMESTAMP,
    last_latency_ms INTEGER,
    failure_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_ready INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    provider_id TEXT,
    model TEXT,
    mode TEXT NOT NULL DEFAULT 'agent',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    user_id TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    idempotency_key TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    token_enc TEXT NOT NULL,
    meta TEXT,
    validation_status TEXT NOT NULL DEFAULT 'untested',
    validation_error_code TEXT,
    last_check_message TEXT,
    validated_at TIMESTAMP,
    last_latency_ms INTEGER,
    failure_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_ready INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    user_id TEXT,
    status TEXT NOT NULL,
    log TEXT NOT NULL DEFAULT '',
    error_code TEXT,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_hash TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS websocket_tickets (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id, is_active)',
  'CREATE INDEX IF NOT EXISTS idx_chats_user_updated ON chats(user_id, updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at ASC)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency ON messages(chat_id, idempotency_key, role) WHERE idempotency_key IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_integrations_user_type ON integrations(user_id, type, is_active)',
  'CREATE INDEX IF NOT EXISTS idx_workspaces_user_name ON workspaces(user_id, name)',
  'CREATE INDEX IF NOT EXISTS idx_agent_runs_chat_status ON agent_runs(chat_id, status)',
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_one_running ON agent_runs(chat_id) WHERE status = 'running'", 
  'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_websocket_tickets_expiry ON websocket_tickets(expires_at)'
] as const;

export async function migrate(): Promise<void> {
  for (const statement of baseStatements) await run(statement);

  await addColumn('users', 'is_active INTEGER NOT NULL DEFAULT 1');
  await addColumn('users', 'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumn('users', 'last_login_at TIMESTAMP');
  await addColumn('messages', 'user_id TEXT');
  await addColumn('messages', 'idempotency_key TEXT');
  await addColumn('agent_runs', 'user_id TEXT');
  await addColumn('agent_runs', 'error_code TEXT');
  await addColumn('agent_runs', 'started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumn('agent_runs', 'completed_at TIMESTAMP');
  await addColumn('providers', "validation_status TEXT NOT NULL DEFAULT 'draft'");
  await addColumn('providers', 'raw_base_url TEXT');
  await addColumn('providers', 'normalized_base_url TEXT');
  await addColumn('providers', 'protocol TEXT');
  await addColumn('providers', 'encryption_version INTEGER NOT NULL DEFAULT 1');
  await addColumn('providers', 'discovered_models TEXT');
  await addColumn('providers', 'capabilities TEXT');
  await addColumn('providers', 'last_check_message TEXT');
  await addColumn('providers', 'last_latency_ms INTEGER');
  await addColumn('providers', 'failure_count INTEGER NOT NULL DEFAULT 0');
  await addColumn('providers', 'next_retry_at TIMESTAMP');
  await addColumn('providers', 'is_ready INTEGER NOT NULL DEFAULT 0');
  await addColumn('providers', 'validation_error_code TEXT');
  await addColumn('providers', 'validated_at TIMESTAMP');
  await addColumn('providers', 'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumn('integrations', "validation_status TEXT NOT NULL DEFAULT 'untested'");
  await addColumn('integrations', 'validation_error_code TEXT');
  await addColumn('integrations', 'validated_at TIMESTAMP');
  await addColumn('integrations', 'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');

  await run('INSERT INTO schema_migrations (version) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = ?)', ['phase1-1.2.0', 'phase1-1.2.0']);
  await run('INSERT INTO schema_migrations (version) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = ?)', ['phase1-1.3.0', 'phase1-1.3.0']);
  await run('INSERT INTO schema_migrations (version) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = ?)', ['providers-2.0.0', 'providers-2.0.0']);
  await run("UPDATE providers SET validation_status = CASE WHEN validation_status = 'verified' THEN 'ready' WHEN validation_status = 'failed' THEN 'configuration_error' WHEN validation_status = 'untested' THEN 'draft' ELSE validation_status END, is_ready = CASE WHEN validation_status IN ('verified', 'ready') THEN 1 ELSE is_ready END");

  const existing = await get<{ id: string }>('SELECT id FROM users WHERE email = ?', [config.defaultAdminEmail]);
  if (!existing) {
    const id = cryptoId();
    const passwordHash = await bcrypt.hash(config.defaultAdminPassword, 12);
    await run(
      'INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [id, config.defaultAdminEmail, passwordHash, 'Moataz Admin', 'admin', 1]
    );
  }
  migrated = true;
}

export function cryptoId(): string {
  return crypto.randomUUID();
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function ping(): Promise<boolean> {
  try {
    await get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

export async function getMigrationStatus(): Promise<{ ready: boolean; versions: string[] }> {
  if (!migrated) return { ready: false, versions: [] };
  const rows = await query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY applied_at ASC');
  return { ready: true, versions: rows.map((row) => row.version) };
}

export async function close(): Promise<void> {
  if (pgPool) await pgPool.end();
  if (sqliteDb?.open) sqliteDb.close();
}
