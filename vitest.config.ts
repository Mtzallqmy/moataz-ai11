import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/src/**/*.test.ts', 'client/src/**/*.test.ts'],
    exclude: ['server/src/**/*.integration.test.ts'],
    setupFiles: ['server/test/unit-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/moataz_test',
      DATABASE_SSL_MODE: 'disable',
      DATABASE_MIGRATIONS_ON_STARTUP: 'false',
      WORKSPACE_DIR: './workspace/unit-tests',
      JWT_SECRET: 'unit-test-jwt-secret-at-least-32-characters',
      ENCRYPTION_KEY: 'unit-test-encryption-key-at-least-32-chars',
      DEFAULT_ADMIN_EMAIL: 'admin@example.com',
      DEFAULT_ADMIN_PASSWORD: 'UnitTestPassword123!',
      APP_URL: 'http://localhost:8080',
      MAX_FILE_BYTES: '64',
      ALLOW_SHELL: 'false',
      TRUST_PROXY: '1'
    },
    coverage: { reporter: ['text', 'json-summary'] }
  }
});
