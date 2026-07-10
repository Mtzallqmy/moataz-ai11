import { rmSync } from 'node:fs';

for (const file of ['./data/integration-test.db', './data/integration-test.db-shm', './data/integration-test.db-wal']) {
  rmSync(file, { force: true });
}
rmSync('./workspace/integration-tests', { recursive: true, force: true });
