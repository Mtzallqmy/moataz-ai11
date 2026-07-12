import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const productionBase = {
  NODE_ENV: 'production',
  APP_URL: 'https://app.example.com',
  JWT_SECRET: 'j'.repeat(32),
  ENCRYPTION_KEY: 'e'.repeat(32),
  DATABASE_URL: 'postgresql://user:password@example.com:5432/app',
  DEFAULT_ADMIN_EMAIL: 'admin@example.com',
  DEFAULT_ADMIN_PASSWORD: 'A-strong-production-password'
};

const railwayBase = {
  ...productionBase,
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:5173',
  CORS_ORIGIN: 'http://localhost:5173',
  TRUST_PROXY: 'false',
  RAILWAY_PROJECT_ID: 'project-id',
  RAILWAY_ENVIRONMENT_ID: 'environment-id',
  RAILWAY_SERVICE_ID: 'service-id',
  RAILWAY_PUBLIC_DOMAIN: 'moataz-ai11-production.up.railway.app'
};

describe('environment validation', () => {
  it('uses APP_URL as the production CORS origin when CORS_ORIGIN is omitted', () => {
    const config = loadConfig(productionBase);
    expect(config.isConfigured).toBe(true);
    expect(config.corsOrigins).toEqual(['https://app.example.com']);
    expect(config.trustProxy).toBe(false);
  });

  it('forces secure production and one-hop proxy settings on Railway', () => {
    const config = loadConfig(railwayBase);
    expect(config.isRailway).toBe(true);
    expect(config.isProduction).toBe(true);
    expect(config.isConfigured).toBe(true);
    expect(config.nodeEnv).toBe('production');
    expect(config.configuredNodeEnv).toBe('development');
    expect(config.trustProxy).toBe(1);
    expect(config.appOrigin).toBe('https://moataz-ai11-production.up.railway.app');
    expect(config.corsOrigins).toContain('https://moataz-ai11-production.up.railway.app');
    expect(config.configurationWarnings).toContain('railway_forced_production_mode');
    expect(config.configurationWarnings).toContain('railway_trust_proxy_forced_to_one_hop');
  });

  it('keeps a configured custom public domain on Railway', () => {
    const config = loadConfig({
      ...railwayBase,
      APP_URL: 'https://ai.example.com',
      CORS_ORIGIN: 'https://dashboard.example.com'
    });
    expect(config.appOrigin).toBe('https://ai.example.com');
    expect(config.corsOrigins).toEqual(['https://ai.example.com', 'https://dashboard.example.com']);
  });

  it('enters configuration-required mode instead of throwing for missing credentials', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      RAILWAY_PROJECT_ID: 'project-id',
      RAILWAY_PUBLIC_DOMAIN: 'moataz-ai11-production.up.railway.app'
    });
    expect(config.isConfigured).toBe(false);
    expect(config.requiredVariables).toEqual(expect.arrayContaining([
      'JWT_SECRET',
      'ENCRYPTION_KEY',
      'DATABASE_URL',
      'DEFAULT_ADMIN_EMAIL',
      'DEFAULT_ADMIN_PASSWORD'
    ]));
  });

  it('reports a loopback APP_URL instead of crashing configuration loading', () => {
    const config = loadConfig({ ...productionBase, APP_URL: 'http://localhost:8080' });
    expect(config.isConfigured).toBe(false);
    expect(config.configurationProblems).toContainEqual({ variable: 'APP_URL', code: 'must_be_public' });
  });

  it('reports weak secrets without generating replacements', () => {
    const config = loadConfig({ ...productionBase, JWT_SECRET: 'short' });
    expect(config.isConfigured).toBe(false);
    expect(config.jwtSecret).toBe('short');
    expect(config.configurationProblems).toContainEqual({ variable: 'JWT_SECRET', code: 'missing_or_short' });
  });

  it('never enables the local shell in production', () => {
    const config = loadConfig({ ...productionBase, ALLOW_SHELL: 'true', SHELL_SANDBOX_MODE: 'local-development' });
    expect(config.shellAvailable).toBe(false);
  });

  it('refuses SQLite in production and on Railway', () => {
    const config = loadConfig({ ...railwayBase, DATABASE_URL: 'file:./data/moataz.db' });
    expect(config.databaseKind).toBe('sqlite');
    expect(config.isConfigured).toBe(false);
    expect(config.configurationProblems).toContainEqual({
      variable: 'DATABASE_URL',
      code: 'postgresql_required_in_production'
    });
  });

  it('rejects invalid numeric limits', () => {
    expect(() => loadConfig({ ...productionBase, MAX_FILE_BYTES: '-1' })).toThrow(/MAX_FILE_BYTES/);
  });
});
