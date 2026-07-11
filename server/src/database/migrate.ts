import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { connectDatabase, database, rawQuery } from './client.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(moduleDir, '../../../drizzle');

export async function runDatabaseMigrations(): Promise<void> {
  await connectDatabase();
  const started = Date.now();
  await migrate(database(), { migrationsFolder });
  logger.info('database_migrations_applied', { durationMs: Date.now() - started });
}

export async function databaseMigrationStatus(): Promise<{ ready: boolean; applied: string[] }> {
  try {
    const rows = await rawQuery<{ hash: string }>(
      `SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`
    );
    const applied = rows.map((row) => row.hash);
    return { ready: applied.length > 0, applied };
  } catch {
    return { ready: false, applied: [] };
  }
}

export async function migrateOnStartupIfEnabled(): Promise<void> {
  if (!config.databaseMigrationsOnStartup) return;
  await runDatabaseMigrations();
}
