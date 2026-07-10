import { close, getMigrationStatus, migrate, ping } from './db.js';

const command = process.argv[2];

try {
  if (command === 'generate') {
    process.stdout.write('Phase 1 uses compatibility SQL migrations; Drizzle generation begins in phase 2.\n');
  } else if (command === 'migrate') {
    await migrate();
    process.stdout.write('Database migrations applied.\n');
  } else if (command === 'check') {
    await migrate();
    const healthy = await ping();
    const status = await getMigrationStatus();
    process.stdout.write(`${JSON.stringify({ healthy, ...status })}\n`);
    if (!healthy || !status.ready) process.exitCode = 1;
  } else {
    process.stderr.write('Usage: db-cli.ts generate|migrate|check\n');
    process.exitCode = 2;
  }
} finally {
  await close();
}
