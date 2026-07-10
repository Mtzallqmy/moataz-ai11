import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/src/**/*.integration.test.ts'],
    setupFiles: ['server/test/integration-setup.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./data/integration-test.db',
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
