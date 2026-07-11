import { rmSync } from 'node:fs';
import { Pool } from 'pg';

rmSync('./workspace/integration-tests', { recursive: true, force: true });

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString || !/^postgres(?:ql)?:/i.test(connectionString)) {
  throw new Error('Integration tests require TEST_DATABASE_URL or DATABASE_URL for PostgreSQL.');
}

const pool = new Pool({ connectionString, ssl: false });
await pool.query('SELECT 1');
await pool.end();
