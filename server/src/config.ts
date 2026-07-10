import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanString = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

const positiveInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return fallback;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a positive integer' });
        return z.NEVER;
      }
      return parsed;
    });

const trustProxySchema = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx): number | boolean | undefined => {
    if (value === undefined || value === '') return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be true, false, or a non-negative integer' });
    return z.NEVER;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveInt(8080),
  APP_URL: z.string().trim().url().optional(),
  JWT_SECRET: z.string().optional().default(''),
  JWT_ACCESS_TTL_SECONDS: positiveInt(900),
  REFRESH_TOKEN_TTL_SECONDS: positiveInt(2_592_000),
  ENCRYPTION_KEY: z.string().optional().default(''),
  DATABASE_URL: z.string().optional().default('file:./data/moataz.db'),
  DATABASE_SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  WORKSPACE_DIR: z.string().min(1).default('./workspace'),
  ALLOW_SHELL: booleanString,
  SHELL_SANDBOX_MODE: z.enum(['disabled', 'local-development']).default('disabled'),
  DEFAULT_ADMIN_EMAIL: z.string().email().default('admin@moataz.ai'),
  DEFAULT_ADMIN_PASSWORD: z.string().optional().default(''),
  TELEGRAM_POLLING: booleanString,
  CORS_ORIGIN: z.string().optional().default(''),
  TRUST_PROXY: trustProxySchema,
  MAX_MESSAGE_CHARS: positiveInt(4000),
  MAX_CONTEXT_MESSAGES: positiveInt(20),
  MAX_TOOL_ITERATIONS: positiveInt(3),
  MAX_FILE_BYTES: positiveInt(1_048_576),
  MAX_LIST_ENTRIES: positiveInt(1000),
  MAX_LIST_DEPTH: positiveInt(8),
  MAX_TOOL_OUTPUT_BYTES: positiveInt(262_144),
  LLM_TIMEOUT_MS: positiveInt(60_000),
  WS_TICKET_TTL_SECONDS: positiveInt(45),
  TERMINAL_MAX_CONNECTIONS_PER_USER: positiveInt(1),
  TERMINAL_IDLE_TIMEOUT_MS: positiveInt(300_000),
  TERMINAL_MAX_SESSION_MS: positiveInt(1_800_000),
  TERMINAL_MAX_INPUT_BYTES: positiveInt(8_192),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RAILWAY_PROJECT_ID: z.string().trim().optional(),
  RAILWAY_ENVIRONMENT_ID: z.string().trim().optional(),
  RAILWAY_SERVICE_ID: z.string().trim().optional(),
  RAILWAY_DEPLOYMENT_ID: z.string().trim().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().trim().optional()
});

export type AppConfig = ReturnType<typeof loadConfig>;

function validationError(error: z.ZodError): Error {
  const details = error.issues.map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`).join('; ');
  return new Error(`Invalid environment configuration: ${details}`);
}

function normalizedOrigin(value: string, variableName: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`Invalid environment configuration: ${variableName} must contain valid absolute URL values`);
  }
}

function railwayOrigin(domain: string | undefined): string | undefined {
  if (!domain) return undefined;
  const candidate = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  return normalizedOrigin(candidate, 'RAILWAY_PUBLIC_DOMAIN');
}

function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === 'localhost'
    || hostname === '::1'
    || hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw validationError(parsed.error);

  const env = parsed.data;
  const isRailway = Boolean(
    env.RAILWAY_PROJECT_ID
    || env.RAILWAY_ENVIRONMENT_ID
    || env.RAILWAY_SERVICE_ID
    || env.RAILWAY_DEPLOYMENT_ID
    || env.RAILWAY_PUBLIC_DOMAIN
  );
  const nodeEnv = isRailway ? 'production' as const : env.NODE_ENV;
  const isProduction = nodeEnv === 'production';
  const warnings: string[] = [];

  if (isRailway && env.NODE_ENV !== 'production') warnings.push('railway_forced_production_mode');

  const jwtSecret = env.JWT_SECRET || (isProduction ? '' : 'development-only-jwt-secret-change-me');
  const encryptionKey = env.ENCRYPTION_KEY || (isProduction ? '' : 'development-only-encryption-key-change-me-32');
  const defaultAdminPassword = env.DEFAULT_ADMIN_PASSWORD || (isProduction ? '' : 'ChangeMe123!');

  if (isProduction && jwtSecret.length < 32) {
    throw new Error('Invalid environment configuration: JWT_SECRET must be at least 32 characters in production');
  }
  if (isProduction && encryptionKey.length < 32) {
    throw new Error('Invalid environment configuration: ENCRYPTION_KEY must be at least 32 characters in production');
  }
  if (isProduction && defaultAdminPassword.length < 12) {
    throw new Error('Invalid environment configuration: DEFAULT_ADMIN_PASSWORD must be at least 12 characters in production');
  }

  const platformOrigin = railwayOrigin(env.RAILWAY_PUBLIC_DOMAIN);
  const configuredAppOrigin = normalizedOrigin(env.APP_URL ?? 'http://localhost:8080', 'APP_URL');
  const shouldUsePlatformOrigin = isRailway && platformOrigin !== undefined && isLoopbackOrigin(configuredAppOrigin);
  const appOrigin = shouldUsePlatformOrigin ? platformOrigin : configuredAppOrigin;
  if (shouldUsePlatformOrigin) warnings.push('railway_app_url_derived_from_public_domain');

  if (isProduction && isLoopbackOrigin(appOrigin)) {
    throw new Error('Invalid environment configuration: APP_URL must be a public URL in production');
  }

  const configuredOrigins = env.CORS_ORIGIN
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => normalizedOrigin(origin, 'CORS_ORIGIN'));
  const corsOrigins = isProduction
    ? [...new Set([appOrigin, ...configuredOrigins])]
    : configuredOrigins;

  const trustProxy = isRailway ? 1 : env.TRUST_PROXY ?? false;
  if (isRailway && env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== 1) {
    warnings.push('railway_trust_proxy_forced_to_one_hop');
  }

  const localShellRequested = env.ALLOW_SHELL && env.SHELL_SANDBOX_MODE === 'local-development';
  const shellAvailable = localShellRequested && !isProduction;
  const databaseKind = env.DATABASE_URL.startsWith('postgres://') || env.DATABASE_URL.startsWith('postgresql://')
    ? 'postgresql' as const
    : 'sqlite' as const;
  if (isRailway && databaseKind === 'sqlite') warnings.push('railway_ephemeral_sqlite_database');

  return Object.freeze({
    configuredNodeEnv: env.NODE_ENV,
    nodeEnv,
    isProduction,
    isRailway,
    deploymentPlatform: isRailway ? 'railway' as const : 'generic' as const,
    configurationWarnings: Object.freeze(warnings),
    port: env.PORT,
    appUrl: appOrigin,
    appOrigin,
    corsOrigins,
    trustProxy,
    jwtSecret,
    jwtAccessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
    refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
    encryptionKey,
    databaseUrl: env.DATABASE_URL,
    databaseKind,
    databaseSslMode: env.DATABASE_SSL_MODE,
    workspaceDir: env.WORKSPACE_DIR,
    allowShellRequested: env.ALLOW_SHELL,
    shellSandboxMode: env.SHELL_SANDBOX_MODE,
    shellAvailable,
    defaultAdminEmail: env.DEFAULT_ADMIN_EMAIL.trim().toLowerCase(),
    defaultAdminPassword,
    telegramPolling: env.TELEGRAM_POLLING,
    maxMessageChars: env.MAX_MESSAGE_CHARS,
    maxContextMessages: env.MAX_CONTEXT_MESSAGES,
    maxToolIterations: env.MAX_TOOL_ITERATIONS,
    maxFileBytes: env.MAX_FILE_BYTES,
    maxListEntries: env.MAX_LIST_ENTRIES,
    maxListDepth: env.MAX_LIST_DEPTH,
    maxToolOutputBytes: env.MAX_TOOL_OUTPUT_BYTES,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    wsTicketTtlSeconds: env.WS_TICKET_TTL_SECONDS,
    terminalMaxConnectionsPerUser: env.TERMINAL_MAX_CONNECTIONS_PER_USER,
    terminalIdleTimeoutMs: env.TERMINAL_IDLE_TIMEOUT_MS,
    terminalMaxSessionMs: env.TERMINAL_MAX_SESSION_MS,
    terminalMaxInputBytes: env.TERMINAL_MAX_INPUT_BYTES,
    logLevel: env.LOG_LEVEL
  });
}

export const config = loadConfig();
