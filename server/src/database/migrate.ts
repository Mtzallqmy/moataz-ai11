import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { migrate as runDrizzleMigrations } from 'drizzle-orm/node-postgres/migrator';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { connectWithRetry, database, pool } from './client.js';

type Journal = {
  entries?: Array<{ tag?: string }>;
};

const migrationsFolder = path.resolve(process.cwd(), 'drizzle');

async function journalTags(): Promise<string[]> {
  try {
    const raw = await readFile(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8');
    const journal = JSON.parse(raw) as Journal;
    return (journal.entries ?? []).flatMap((entry) => typeof entry.tag === 'string' ? [entry.tag] : []);
  } catch {
    return [];
  }
}

export function shouldMigrateOnStartup(): boolean {
  return config.databaseMigrationsOnStartup;
}

export async function migrateDatabase(): Promise<void> {
  await connectWithRetry();
  logger.info('database_migration_started', { migrationsFolder: 'drizzle' });
  await runDrizzleMigrations(database, { migrationsFolder });
  logger.info('database_migration_completed');
}

export async function migrationStatus(): Promise<{ ready: boolean; applied: string[]; pending: string[] }> {
  const tags = await journalTags();
  try {
    const result = await pool.query<{ id: number }>(
      `SELECT id FROM drizzle.__drizzle_migrations ORDER BY created_at ASC, id ASC`
    );
    const appliedCount = result.rows.length;
    const applied = tags.length > 0 ? tags.slice(0, appliedCount) : result.rows.map((row) => String(row.id));
    const pending = tags.slice(appliedCount);
    return { ready: pending.length === 0 && appliedCount >= tags.length, applied, pending };
  } catch {
    return { ready: false, applied: [], pending: tags.length > 0 ? tags : ['migration_history_unavailable'] };
  }
}
