import { closeDatabase, connectWithRetry, pingDatabase } from './database/client.js';
import { ensureDefaultAdmin } from './database/bootstrap.js';
import { migrateDatabase, migrationStatus } from './database/migrate.js';

const command = process.argv[2];

try {
  if (command === 'migrate') {
    await migrateDatabase();
    await ensureDefaultAdmin();
    process.stdout.write('PostgreSQL migrations applied.\n');
  } else if (command === 'check') {
    await connectWithRetry();
    const healthy = await pingDatabase();
    const status = await migrationStatus();
    process.stdout.write(`${JSON.stringify({ healthy, ...status })}\n`);
    if (!healthy || !status.ready) process.exitCode = 1;
  } else if (command === 'seed') {
    await connectWithRetry();
    await ensureDefaultAdmin();
    process.stdout.write('Default administrator seed verified.\n');
  } else {
    process.stderr.write('Usage: db-cli.ts migrate|check|seed\n');
    process.exitCode = 2;
  }
} finally {
  await closeDatabase();
}
