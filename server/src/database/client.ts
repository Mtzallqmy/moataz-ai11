import fs from 'node:fs';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

let poolInstance: Pool | undefined;
let dbInstance: Database | undefined;
let closing = false;

function sslConfig(): PoolConfig['ssl'] {
  if (config.databaseSslMode === 'disable') return false;
  const ca = config.databaseSslCa?.trim();
  if (config.databaseSslMode === 'verify-full' && !ca) {
    throw new AppError('database_ssl_ca_required', 500, 'DATABASE_SSL_CA is required when DATABASE_SSL_MODE=verify-full.');
  }
  return {
    rejectUnauthorized: true,
    ...(ca ? { ca: ca.includes('BEGIN CERTIFICATE') ? ca : fs.readFileSync(ca, 'utf8') } : {})
  };
}

function poolConfig(): PoolConfig {
  if (config.databaseKind !== 'postgresql' || !config.databaseUrl) {
    throw new AppError('database_postgresql_required', 500, 'PostgreSQL DATABASE_URL is required.');
  }
  return {
    connectionString: config.databaseUrl,
    ssl: sslConfig(),
    max: config.databasePoolMax,
    min: config.databasePoolMin,
    idleTimeoutMillis: config.databaseIdleTimeoutMs,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    statement_timeout: config.databaseStatementTimeoutMs,
    query_timeout: config.databaseQueryTimeoutMs,
    application_name: 'moataz-ai'
  };
}

export function databasePool(): Pool {
  if (closing) throw new AppError('database_closing', 503);
  if (!poolInstance) {
    poolInstance = new Pool(poolConfig());
    poolInstance.on('error', (error) => logger.error('database_pool_error', {
      code: typeof (error as NodeJS.ErrnoException).code === 'string' ? (error as NodeJS.ErrnoException).code : 'unknown',
      message: error.message.slice(0, 300)
    }));
  }
  return poolInstance;
}

export function database(): Database {
  if (!dbInstance) dbInstance = drizzle(databasePool(), { schema });
  return dbInstance;
}

export async function withPoolClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await databasePool().connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function rawQuery<T extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<T[]> {
  const result = await databasePool().query<T>({
    text,
    values: [...values],
    query_timeout: config.databaseQueryTimeoutMs
  });
  return result.rows;
}

export async function connectDatabase(options: { attempts?: number } = {}): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 5);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await databasePool().query({ text: 'SELECT 1', query_timeout: config.databaseConnectionTimeoutMs });
      logger.info('database_connected', { attempt, poolMax: config.databasePoolMax, sslMode: config.databaseSslMode });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delayMs = Math.min(250 * 2 ** (attempt - 1), 4_000);
      logger.warn('database_connect_retry', { attempt, delayMs, code: (error as NodeJS.ErrnoException).code ?? 'unknown' });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new AppError('database_connection_failed', 503, lastError instanceof Error ? lastError.message : 'Database connection failed.');
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await databasePool().query({ text: 'SELECT 1', query_timeout: Math.min(config.databaseQueryTimeoutMs, 5_000) });
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  if (!poolInstance) return;
  closing = true;
  const current = poolInstance;
  poolInstance = undefined;
  dbInstance = undefined;
  try {
    await current.end();
  } finally {
    closing = false;
  }
}
