import path from 'node:path';
import { migrate as runDrizzleMigrations } from 'drizzle-orm/node-postgres/migrator';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { connectWithRetry, database, pool } from './client.js';

export async function migrateDatabase(): Promise<void> {
  await connectWithRetry();
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  const started = Date.now();
  try {
    await runDrizzleMigrations(database, { migrationsFolder });
    logger.info('database_migrations_completed', { durationMs: Date.now() - started });
  } catch (error) {
    logger.error('database_migrations_failed', {
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new AppError('database_migration_failed', 503, 'Database migrations failed.');
  }
}

export async function migrationStatus(): Promise<{ ready: boolean; applied: string[]; pending: string[] }> {
  try {
    const result = await pool.query<{ hash: string; created_at: string }>(
      `SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`
    );
    return { ready: result.rows.length > 0, applied: result.rows.map((row) => row.hash), pending: [] };
  } catch {
    return { ready: false, applied: [], pending: ['0000_phase12_postgres'] };
  }
}

export function shouldMigrateOnStartup(): boolean {
  return config.databaseMigrationsOnStartup;
}
