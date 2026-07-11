import { defineConfig } from 'drizzle-kit';
import { z } from 'zod';

const env = z.object({
  DATABASE_URL: z.string().trim().url().refine((value) => /^postgres(?:ql)?:/i.test(value), 'DATABASE_URL must use PostgreSQL')
}).parse(process.env);

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/src/database/schema.ts',
  out: './drizzle',
  dbCredentials: { url: env.DATABASE_URL },
  strict: true,
  verbose: true
});
