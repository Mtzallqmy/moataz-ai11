import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/^postgres(?:ql)?:/i.test(databaseUrl)) {
  throw new Error('DATABASE_URL or TEST_DATABASE_URL must be a PostgreSQL connection string.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/src/database/schema.ts',
  out: './drizzle',
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true
});
