import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import * as schema from './schema.js';

function sslConfig(): PoolConfig['ssl'] {
  if (config.databaseSslMode === 'disable') return false;
  if (config.databaseSslMode === 'require') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

function sanitizedDatabaseError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: 'DatabaseError' };
  const record = error as Error & { code?: string; severity?: string; constraint?: string; table?: string };
  return {
    name: record.name,
    ...(record.code ? { code: record.code } : {}),
    ...(record.severity ? { severity: record.severity } : {}),
    ...(record.constraint ? { constraint: record.constraint } : {}),
    ...(record.table ? { table: record.table } : {})
  };
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslConfig(),
  max: config.databasePoolMax,
  idleTimeoutMillis: config.databaseIdleTimeoutMs,
  connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  statement_timeout: config.databaseStatementTimeoutMs,
  query_timeout: config.databaseStatementTimeoutMs,
  application_name: 'moataz-ai'
});

pool.on('error', (error) => {
  logger.error('database_pool_error', sanitizedDatabaseError(error));
});

export const database: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

export async function connectWithRetry(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.databaseStartupRetries; attempt += 1) {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      logger.warn('database_startup_retry', {
        attempt,
        maxAttempts: config.databaseStartupRetries,
        ...sanitizedDatabaseError(error)
      });
      if (attempt < config.databaseStartupRetries) {
        await delay(Math.min(500 * 2 ** (attempt - 1), 5_000));
      }
    } finally {
      client?.release();
    }
  }
  throw new AppError('database_unavailable', 503, 'The PostgreSQL database is unavailable.', sanitizedDatabaseError(lastError));
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export async function withTransaction<T>(callback: (tx: NodePgDatabase<typeof schema>) => Promise<T>): Promise<T> {
  return database.transaction(callback);
}
