import { ensureDefaultAdmin } from './database/bootstrap.js';
import { closeDatabase, pingDatabase } from './database/client.js';
import { cryptoId, sha256 } from './database/ids.js';
import { migrateDatabase, migrationStatus, shouldMigrateOnStartup } from './database/migrate.js';

export type DbRow = Record<string, unknown>;
export { cryptoId, sha256 };

export async function migrate(): Promise<void> {
  if (shouldMigrateOnStartup()) await migrateDatabase();
  await ensureDefaultAdmin();
}

export async function ping(): Promise<boolean> {
  return pingDatabase();
}

export async function getMigrationStatus() {
  return migrationStatus();
}

export async function close(): Promise<void> {
  await closeDatabase();
}
