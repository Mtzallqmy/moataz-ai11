import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/src/**/*.integration.test.ts'],
    setupFiles: ['server/test/integration-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/moataz_test',
      DATABASE_SSL_MODE: 'disable',
      DATABASE_MIGRATIONS_ON_STARTUP: 'true',
      DATABASE_POOL_MAX: '5',
      WORKSPACE_DIR: './workspace/integration-tests',
      JWT_SECRET: 'integration-test-jwt-secret-at-least-32-chars',
      ENCRYPTION_KEY: 'integration-test-encryption-key-at-least-32',
      DEFAULT_ADMIN_EMAIL: 'admin@example.com',
      DEFAULT_ADMIN_PASSWORD: 'IntegrationPassword123!',
      APP_URL: 'http://localhost:8080',
      ALLOW_SHELL: 'false'
    }
  }
});
