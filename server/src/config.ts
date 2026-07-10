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
  .optional()
  .transform((value, ctx): number | boolean => {
    if (value === undefined || value === '') return false;
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
  APP_URL: z.string().url().default('http://localhost:8080'),
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
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type AppConfig = ReturnType<typeof loadConfig>;

function validationError(error: z.ZodError): Error {
  const details = error.issues.map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`).join('; ');
  return new Error(`Invalid environment configuration: ${details}`);
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw validationError(parsed.error);

  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
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

  const appOrigin = new URL(env.APP_URL).origin;
  const configuredOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
  const corsOrigins = (configuredOrigins.length > 0 ? configuredOrigins : isProduction ? [appOrigin] : [])
    .map((origin) => new URL(origin).origin);

  const localShellRequested = env.ALLOW_SHELL && env.SHELL_SANDBOX_MODE === 'local-development';
  const shellAvailable = localShellRequested && !isProduction;

  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    isProduction,
    port: env.PORT,
    appUrl: env.APP_URL,
    appOrigin,
    corsOrigins,
    trustProxy: env.TRUST_PROXY === false && isProduction ? 1 : env.TRUST_PROXY,
    jwtSecret,
    jwtAccessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
    refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
    encryptionKey,
    databaseUrl: env.DATABASE_URL,
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
