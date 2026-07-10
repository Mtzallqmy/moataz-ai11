import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const productionBase = {
  NODE_ENV: 'production',
  APP_URL: 'https://app.example.com',
  JWT_SECRET: 'j'.repeat(32),
  ENCRYPTION_KEY: 'e'.repeat(32),
  DEFAULT_ADMIN_PASSWORD: 'A-strong-production-password'
};

describe('environment validation', () => {
  it('fails closed to APP_URL origin when CORS_ORIGIN is omitted in production', () => {
    const config = loadConfig(productionBase);
    expect(config.corsOrigins).toEqual(['https://app.example.com']);
    expect(config.trustProxy).toBe(1);
  });

  it('rejects weak production secrets', () => {
    expect(() => loadConfig({ ...productionBase, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('never enables the local shell in production', () => {
    const config = loadConfig({ ...productionBase, ALLOW_SHELL: 'true', SHELL_SANDBOX_MODE: 'local-development' });
    expect(config.shellAvailable).toBe(false);
  });

  it('rejects invalid numeric limits', () => {
    expect(() => loadConfig({ ...productionBase, MAX_FILE_BYTES: '-1' })).toThrow(/MAX_FILE_BYTES/);
  });
});
