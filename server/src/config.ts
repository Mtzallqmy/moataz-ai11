import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const optionalTrimmedString = z.preprocess(blankToUndefined, z.string().trim().optional());
const optionalUrl = z.preprocess(blankToUndefined, z.string().trim().url().optional());
const optionalEmail = z.preprocess(blankToUndefined, z.string().trim().email().optional());

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
  APP_URL: optionalUrl,
  JWT_SECRET: optionalString,
  JWT_ACCESS_TTL_SECONDS: positiveInt(900),
  REFRESH_TOKEN_TTL_SECONDS: positiveInt(2_592_000),
  ENCRYPTION_KEY: optionalString,
  DATABASE_URL: optionalTrimmedString,
  DATABASE_SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DATABASE_SSL_CA: optionalTrimmedString,
  DATABASE_POOL_MAX: positiveInt(10),
  DATABASE_CONNECTION_TIMEOUT_MS: positiveInt(10_000),
  DATABASE_IDLE_TIMEOUT_MS: positiveInt(30_000),
  DATABASE_STATEMENT_TIMEOUT_MS: positiveInt(30_000),
  DATABASE_CONNECT_ATTEMPTS: positiveInt(5),
  WORKSPACE_DIR: z.string().min(1).default('./workspace'),
  ALLOW_SHELL: booleanString,
  ALLOW_LOCAL_AI_PROVIDERS: booleanString,
  SHELL_SANDBOX_MODE: z.enum(['disabled', 'local-development']).default('disabled'),
  DEFAULT_ADMIN_EMAIL: optionalEmail,
  DEFAULT_ADMIN_PASSWORD: optionalString,
  TELEGRAM_POLLING: booleanString,
  CORS_ORIGIN: z.string().optional().default(''),
  TRUST_PROXY: trustProxySchema,
  MAX_MESSAGE_CHARS: positiveInt(12_000),
  MAX_CONTEXT_MESSAGES: positiveInt(30),
  MAX_TOOL_ITERATIONS: positiveInt(5),
  MAX_FILE_BYTES: positiveInt(2_097_152),
  MAX_UPLOAD_BYTES: positiveInt(10_485_760),
  MAX_ATTACHMENTS_PER_MESSAGE: positiveInt(8),
  MAX_ATTACHMENT_CONTEXT_CHARS: positiveInt(80_000),
  MAX_ATTACHMENT_FILE_CHARS: positiveInt(40_000),
  MAX_VISION_IMAGES: positiveInt(4),
  MAX_VISION_IMAGE_BYTES: positiveInt(5_242_880),
  MAX_LIST_ENTRIES: positiveInt(1000),
  MAX_LIST_DEPTH: positiveInt(8),
  MAX_TOOL_OUTPUT_BYTES: positiveInt(262_144),
  LLM_TIMEOUT_MS: positiveInt(90_000),
  WEB_FETCH_TIMEOUT_MS: positiveInt(20_000),
  MAX_WEB_FETCH_BYTES: positiveInt(1_048_576),
  SANDBOX_TIMEOUT_MS: positiveInt(120_000),
  WS_TICKET_TTL_SECONDS: positiveInt(45),
  TERMINAL_MAX_CONNECTIONS_PER_USER: positiveInt(1),
  TERMINAL_IDLE_TIMEOUT_MS: positiveInt(300_000),
  TERMINAL_MAX_SESSION_MS: positiveInt(1_800_000),
  TERMINAL_MAX_INPUT_BYTES: positiveInt(8_192),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RAILWAY_PROJECT_ID: optionalTrimmedString,
  RAILWAY_ENVIRONMENT_ID: optionalTrimmedString,
  RAILWAY_SERVICE_ID: optionalTrimmedString,
  RAILWAY_DEPLOYMENT_ID: optionalTrimmedString,
  RAILWAY_PUBLIC_DOMAIN: optionalTrimmedString
});

export type ConfigurationProblem = {
  variable: string;
  code: string;
};

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
  if (!origin) return false;
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === 'localhost'
    || hostname === '::1'
    || hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function addProblem(problems: ConfigurationProblem[], variable: string, code: string): void {
  if (!problems.some((problem) => problem.variable === variable && problem.code === code)) {
    problems.push({ variable, code });
  }
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
  const problems: ConfigurationProblem[] = [];

  if (isRailway && env.NODE_ENV !== 'production') warnings.push('railway_forced_production_mode');

  const jwtSecret = env.JWT_SECRET ?? '';
  const encryptionKey = env.ENCRYPTION_KEY ?? '';
  const databaseUrl = env.DATABASE_URL ?? '';
  const defaultAdminEmail = env.DEFAULT_ADMIN_EMAIL?.toLowerCase() ?? '';
  const defaultAdminPassword = env.DEFAULT_ADMIN_PASSWORD ?? '';

  if (jwtSecret.length < 32) addProblem(problems, 'JWT_SECRET', 'missing_or_short');
  if (encryptionKey.length < 32) addProblem(problems, 'ENCRYPTION_KEY', 'missing_or_short');

  const databaseKind = /^postgres(?:ql)?:/i.test(databaseUrl)
    ? 'postgresql' as const
    : databaseUrl.startsWith('file:')
      ? 'sqlite' as const
      : databaseUrl
        ? 'unsupported' as const
        : 'unconfigured' as const;
  if (databaseKind === 'unconfigured') addProblem(problems, 'DATABASE_URL', 'missing');
  if (databaseKind === 'unsupported') addProblem(problems, 'DATABASE_URL', 'unsupported_scheme');
  if (isProduction && databaseKind === 'sqlite') addProblem(problems, 'DATABASE_URL', 'postgresql_required_in_production');
  if (databaseKind === 'postgresql' && env.DATABASE_SSL_MODE === 'verify-full' && !env.DATABASE_SSL_CA) {
    addProblem(problems, 'DATABASE_SSL_CA', 'required_for_verify_full');
  }

  if (!defaultAdminEmail) addProblem(problems, 'DEFAULT_ADMIN_EMAIL', 'missing');
  if (!defaultAdminPassword) addProblem(problems, 'DEFAULT_ADMIN_PASSWORD', 'missing');
  else if (defaultAdminPassword.length < 12) addProblem(problems, 'DEFAULT_ADMIN_PASSWORD', 'too_short');

  const platformOrigin = railwayOrigin(env.RAILWAY_PUBLIC_DOMAIN);
  const configuredAppOrigin = env.APP_URL ? normalizedOrigin(env.APP_URL, 'APP_URL') : undefined;
  const shouldUsePlatformOrigin = isRailway
    && platformOrigin !== undefined
    && (configuredAppOrigin === undefined || isLoopbackOrigin(configuredAppOrigin));
  const appOrigin = shouldUsePlatformOrigin ? platformOrigin : configuredAppOrigin ?? platformOrigin ?? '';
  if (shouldUsePlatformOrigin && configuredAppOrigin) warnings.push('railway_app_url_derived_from_public_domain');

  if (!appOrigin) addProblem(problems, 'APP_URL', 'missing');
  else if (isProduction && isLoopbackOrigin(appOrigin)) addProblem(problems, 'APP_URL', 'must_be_public');

  const configuredOrigins = env.CORS_ORIGIN
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => normalizedOrigin(origin, 'CORS_ORIGIN'));
  const corsOrigins = appOrigin
    ? [...new Set([appOrigin, ...configuredOrigins])]
    : [...new Set(configuredOrigins)];

  const trustProxy = isRailway ? 1 : env.TRUST_PROXY ?? false;
  if (isRailway && env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== 1) {
    warnings.push('railway_trust_proxy_forced_to_one_hop');
  }

  const localShellRequested = env.ALLOW_SHELL && env.SHELL_SANDBOX_MODE === 'local-development';
  const shellAvailable = localShellRequested && !isProduction;

  const requiredVariables = [...new Set(problems.map((problem) => problem.variable))];

  return Object.freeze({
    configuredNodeEnv: env.NODE_ENV,
    nodeEnv,
    isProduction,
    isRailway,
    isConfigured: problems.length === 0,
    deploymentPlatform: isRailway ? 'railway' as const : 'generic' as const,
    configurationProblems: Object.freeze(problems.map((problem) => Object.freeze(problem))),
    requiredVariables: Object.freeze(requiredVariables),
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
    databaseUrl,
    databaseKind,
    databaseSslMode: env.DATABASE_SSL_MODE,
    databaseSslCa: env.DATABASE_SSL_CA ?? '',
    databasePoolMax: env.DATABASE_POOL_MAX,
    databaseConnectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS,
    databaseIdleTimeoutMs: env.DATABASE_IDLE_TIMEOUT_MS,
    databaseStatementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    databaseConnectAttempts: env.DATABASE_CONNECT_ATTEMPTS,
    workspaceDir: env.WORKSPACE_DIR,
    allowShellRequested: env.ALLOW_SHELL,
    allowLocalAiProviders: env.ALLOW_LOCAL_AI_PROVIDERS && !isProduction,
    shellSandboxMode: env.SHELL_SANDBOX_MODE,
    shellAvailable,
    defaultAdminEmail,
    defaultAdminPassword,
    telegramPolling: env.TELEGRAM_POLLING,
    maxMessageChars: env.MAX_MESSAGE_CHARS,
    maxContextMessages: env.MAX_CONTEXT_MESSAGES,
    maxToolIterations: env.MAX_TOOL_ITERATIONS,
    maxFileBytes: env.MAX_FILE_BYTES,
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    maxAttachmentsPerMessage: env.MAX_ATTACHMENTS_PER_MESSAGE,
    maxAttachmentContextChars: env.MAX_ATTACHMENT_CONTEXT_CHARS,
    maxAttachmentFileChars: env.MAX_ATTACHMENT_FILE_CHARS,
    maxVisionImages: env.MAX_VISION_IMAGES,
    maxVisionImageBytes: env.MAX_VISION_IMAGE_BYTES,
    maxListEntries: env.MAX_LIST_ENTRIES,
    maxListDepth: env.MAX_LIST_DEPTH,
    maxToolOutputBytes: env.MAX_TOOL_OUTPUT_BYTES,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    webFetchTimeoutMs: env.WEB_FETCH_TIMEOUT_MS,
    maxWebFetchBytes: env.MAX_WEB_FETCH_BYTES,
    sandboxTimeoutMs: env.SANDBOX_TIMEOUT_MS,
    wsTicketTtlSeconds: env.WS_TICKET_TTL_SECONDS,
    terminalMaxConnectionsPerUser: env.TERMINAL_MAX_CONNECTIONS_PER_USER,
    terminalIdleTimeoutMs: env.TERMINAL_IDLE_TIMEOUT_MS,
    terminalMaxSessionMs: env.TERMINAL_MAX_SESSION_MS,
    terminalMaxInputBytes: env.TERMINAL_MAX_INPUT_BYTES,
    logLevel: env.LOG_LEVEL
  });
}

export const config = loadConfig();
