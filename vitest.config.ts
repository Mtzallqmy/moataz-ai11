import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/src/**/*.test.ts', 'client/src/**/*.test.ts'],
    exclude: ['server/src/**/*.integration.test.ts'],
    setupFiles: ['server/test/unit-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./data/unit-test.db',
      WORKSPACE_DIR: './workspace/unit-tests',
      JWT_SECRET: 'unit-test-jwt-secret-at-least-32-characters',
      ENCRYPTION_KEY: 'unit-test-encryption-key-at-least-32-chars',
      DEFAULT_ADMIN_PASSWORD: 'UnitTestPassword123!',
      MAX_FILE_BYTES: '64',
      ALLOW_SHELL: 'false'
    },
    coverage: { reporter: ['text', 'json-summary'] }
  }
});
