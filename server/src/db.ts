import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { logger } from './logger.js';

export type DbRow = Record<string, unknown>;
export type SqlParams = readonly unknown[];
export type SqlOperation = { sql: string; params?: SqlParams };

const isPostgres = /^postgres(?:ql)?:/i.test(config.databaseUrl);
type SqliteStatement = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => unknown;
};

type SqliteDatabase = {
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
  open?: boolean;
  pragma?: (value: string) => unknown;
  exec?: (sql: string) => unknown;
  transaction?: <T extends (...args: never[]) => unknown>(callback: T) => T;
};

type SqliteConstructor = new (filename: string) => SqliteDatabase;

let sqliteDb: SqliteDatabase | undefined;
let pgPool: Pool | undefined;
let migrated = false;

const dbPath = config.databaseUrl.startsWith('file:')
  ? config.databaseUrl.slice('file:'.length)
  : './data/moataz.db';

function postgresSsl(): false | { rejectUnauthorized: boolean; ca?: string } | undefined {
  if (!isPostgres || config.databaseSslMode === 'disable') return undefined;
  if (config.databaseSslMode === 'require') return { rejectUnauthorized: false };
  const caValue = config.databaseSslCa.trim();
  if (!caValue) {
    throw new Error('DATABASE_SSL_CA is required when DATABASE_SSL_MODE=verify-full');
  }
  const ca = caValue.includes('BEGIN CERTIFICATE') ? caValue : fs.readFileSync(caValue, 'utf8');
  return { rejectUnauthorized: true, ca };
}

if (isPostgres) {
  pgPool = new Pool({
    connectionString: config.databaseUrl,
    ssl: postgresSsl(),
    max: config.databasePoolMax,
    min: 0,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    idleTimeoutMillis: config.databaseIdleTimeoutMs,
    statement_timeout: config.databaseStatementTimeoutMs,
    application_name: 'moataz-ai'
  });
  pgPool.on('error', (error) => logger.error('database_pool_error', { error: error.message }));
} else {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  let Database: SqliteConstructor | undefined;
  let nativeError: unknown;
  try {
    const module = await import('better-sqlite3');
    Database = module.default as unknown as SqliteConstructor;
  } catch (error) {
    nativeError = error;
  }

  if (Database) {
    try {
      sqliteDb = new Database(dbPath);
      sqliteDb.pragma?.('journal_mode = WAL');
      sqliteDb.pragma?.('foreign_keys = ON');
      sqliteDb.pragma?.('busy_timeout = 5000');
    } catch (error) {
      nativeError = error;
      sqliteDb = undefined;
      Database = undefined;
    }
  }

  if (!sqliteDb && !config.isProduction) {
    // Node 22 provides an experimental built-in SQLite implementation. It is
    // used only as a local/test fallback when the optional native binding is
    // unavailable; production deployments remain PostgreSQL-only.
    try {
      const builtinLoader = (process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
      if (!builtinLoader) throw new Error('Node built-in module loader is unavailable');
      const builtin = builtinLoader('node:sqlite') as { DatabaseSync?: SqliteConstructor } | undefined;
      if (!builtin?.DatabaseSync) throw new Error('node:sqlite is unavailable in this Node.js version');
      sqliteDb = new builtin.DatabaseSync(dbPath);
      sqliteDb.exec?.('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      logger.warn('sqlite_builtin_fallback_enabled', { nodeVersion: process.versions.node });
    } catch (builtinError) {
      throw new Error(`SQLite support is unavailable. Install better-sqlite3 or use PostgreSQL. Native error: ${nativeError instanceof Error ? nativeError.message : String(nativeError)}; built-in error: ${builtinError instanceof Error ? builtinError.message : String(builtinError)}`);
    }
  } else if (!sqliteDb) {
    throw new Error(`SQLite support is unavailable in production. Configure PostgreSQL DATABASE_URL. Native error: ${nativeError instanceof Error ? nativeError.message : String(nativeError)}`);
  }
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

  if (sqliteDb!.transaction) {
    const execute = sqliteDb!.transaction((ops: readonly SqlOperation[]) => {
      for (const operation of ops) {
        sqliteDb!.prepare(operation.sql).run(...(operation.params ?? []));
      }
    });
    execute(operations as never);
    return;
  }

  sqliteDb!.exec?.('BEGIN IMMEDIATE');
  try {
    for (const operation of operations) {
      sqliteDb!.prepare(operation.sql).run(...(operation.params ?? []));
    }
    sqliteDb!.exec?.('COMMIT');
  } catch (error) {
    sqliteDb!.exec?.('ROLLBACK');
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = typeof (error as NodeJS.ErrnoException | undefined)?.code === 'string'
    ? (error as NodeJS.ErrnoException).code
    : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return code === '23505' || message.includes('unique constraint') || message.includes('duplicate key');
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
    protocol TEXT NOT NULL DEFAULT 'openai-compatible',
    base_url TEXT,
    api_key_enc TEXT NOT NULL,
    key_last_four TEXT,
    custom_headers_enc TEXT,
    credential_version INTEGER NOT NULL DEFAULT 1,
    streaming_enabled INTEGER NOT NULL DEFAULT 1,
    default_model TEXT NOT NULL,
    validation_status TEXT NOT NULL DEFAULT 'untested',
    validation_error_code TEXT,
    last_error_message TEXT,
    validated_at TIMESTAMP,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS provider_models (
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    display_name TEXT,
    capabilities TEXT,
    discovered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_verified_at TIMESTAMP,
    PRIMARY KEY (provider_id, model_id),
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS provider_request_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    protocol TEXT NOT NULL,
    base_url_host TEXT,
    endpoint_path TEXT,
    model TEXT,
    stream INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER,
    provider_error_type TEXT,
    latency_ms INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    request_id TEXT,
    upstream_request_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
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
    status TEXT NOT NULL DEFAULT 'completed',
    tool_calls TEXT,
    idempotency_key TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message_id TEXT,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
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
    validated_at TIMESTAMP,
    is_active INTEGER NOT NULL DEFAULT 1,
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
  'CREATE INDEX IF NOT EXISTS idx_provider_models_provider_discovered ON provider_models(provider_id, discovered_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_provider_request_logs_user_created ON provider_request_logs(user_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_provider_request_logs_provider_created ON provider_request_logs(provider_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_chats_user_updated ON chats(user_id, updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at ASC)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency ON messages(chat_id, idempotency_key, role) WHERE idempotency_key IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_attachments_chat_message ON attachments(chat_id, message_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_attachments_user_pending ON attachments(user_id, chat_id, message_id)',
  'CREATE INDEX IF NOT EXISTS idx_integrations_user_type ON integrations(user_id, type, is_active)',
  'CREATE INDEX IF NOT EXISTS idx_workspaces_user_name ON workspaces(user_id, name)',
  'CREATE INDEX IF NOT EXISTS idx_agent_runs_chat_status ON agent_runs(chat_id, status)',
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_one_running ON agent_runs(chat_id) WHERE status = 'running'",
  'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_websocket_tickets_expiry ON websocket_tickets(expires_at)'
] as const;

async function connectWithRetry(): Promise<void> {
  if (!isPostgres) return;
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.databaseConnectAttempts; attempt += 1) {
    try {
      await pgPool!.query('SELECT 1');
      if (attempt > 1) logger.info('database_connected_after_retry', { attempt });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= config.databaseConnectAttempts) break;
      const delayMs = Math.min(250 * 2 ** (attempt - 1), 4_000);
      logger.warn('database_connect_retry', {
        attempt,
        delayMs,
        code: typeof (error as NodeJS.ErrnoException).code === 'string' ? (error as NodeJS.ErrnoException).code : 'unknown'
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Database connection failed');
}

export async function migrate(): Promise<void> {
  if (migrated) return;
  await connectWithRetry();
  for (const statement of baseStatements) await run(statement);

  await addColumn('users', 'is_active INTEGER NOT NULL DEFAULT 1');
  await addColumn('users', 'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumn('users', 'last_login_at TIMESTAMP');
  await addColumn('messages', 'user_id TEXT');
  await addColumn('messages', 'idempotency_key TEXT');
  await addColumn('messages', "status TEXT NOT NULL DEFAULT 'completed'");
  await addColumn('agent_runs', 'user_id TEXT');
  await addColumn('agent_runs', 'error_code TEXT');
  await addColumn('agent_runs', 'started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumn('agent_runs', 'completed_at TIMESTAMP');
  await addColumn('providers', "protocol TEXT NOT NULL DEFAULT 'openai-compatible'");
  await addColumn('providers', 'key_last_four TEXT');
  await addColumn('providers', 'custom_headers_enc TEXT');
  await addColumn('providers', 'credential_version INTEGER NOT NULL DEFAULT 1');
  await addColumn('providers', 'streaming_enabled INTEGER NOT NULL DEFAULT 1');
  await addColumn('providers', "validation_status TEXT NOT NULL DEFAULT 'untested'");
  await addColumn('providers', 'validation_error_code TEXT');
  await addColumn('providers', 'last_error_message TEXT');
  await addColumn('providers', 'validated_at TIMESTAMP');
  await addColumn('providers', 'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumn('integrations', "validation_status TEXT NOT NULL DEFAULT 'untested'");
  await addColumn('integrations', 'validation_error_code TEXT');
  await addColumn('integrations', 'validated_at TIMESTAMP');
  await addColumn('integrations', 'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');

  // Preserve the protocol of existing provider rows created before protocol was persisted.
  await run("UPDATE providers SET protocol = 'openai' WHERE type = 'openai'");
  await run("UPDATE providers SET protocol = 'anthropic' WHERE type = 'anthropic'");
  await run("UPDATE providers SET protocol = 'gemini' WHERE type = 'gemini'");
  await run("UPDATE providers SET protocol = 'openai-compatible' WHERE type NOT IN ('openai', 'anthropic', 'gemini') OR protocol IS NULL OR protocol = ''");
  await run("UPDATE providers SET default_model = '' WHERE LOWER(TRIM(default_model)) IN ('auto', 'default', 'free', 'latest')");

  for (const version of ['phase1-1.2.0', 'phase1-1.3.0', 'phase1-1.5.0', 'production-hardening-1.5.1', 'provider-runtime-1.6.0']) {
    try {
      await run(
        'INSERT INTO schema_migrations (version) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = ?)',
        [version, version]
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  const existing = await get<{ id: string }>('SELECT id FROM users WHERE email = ?', [config.defaultAdminEmail]);
  if (!existing) {
    const id = cryptoId();
    const passwordHash = await bcrypt.hash(config.defaultAdminPassword, 12);
    try {
      await run(
        'INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
        [id, config.defaultAdminEmail, passwordHash, 'Moataz Admin', 'admin', 1]
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  migrated = true;
  logger.info('database_migrations_ready', { databaseKind: config.databaseKind });
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
  if (pgPool) {
    await pgPool.end();
    pgPool = undefined;
  }
  if (sqliteDb?.open) sqliteDb.close();
  sqliteDb = undefined;
  migrated = false;
}
