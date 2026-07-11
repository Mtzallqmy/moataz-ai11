from pathlib import Path

path = Path('server/src/config.ts')
text = path.read_text()


def replace(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, found {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)

replace(
"""const positiveInt = (fallback: number) =>
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
""",
"""const positiveInt = (fallback: number) =>
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

const nonNegativeInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return fallback;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a non-negative integer' });
        return z.NEVER;
      }
      return parsed;
    });
"""
)
replace(
"""  DATABASE_URL: optionalTrimmedString,
  DATABASE_SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
""",
"""  DATABASE_URL: optionalTrimmedString,
  DATABASE_SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DATABASE_SSL_CA: optionalString,
  DATABASE_POOL_MAX: positiveInt(10),
  DATABASE_POOL_MIN: nonNegativeInt(0),
  DATABASE_IDLE_TIMEOUT_MS: positiveInt(30_000),
  DATABASE_CONNECTION_TIMEOUT_MS: positiveInt(10_000),
  DATABASE_STATEMENT_TIMEOUT_MS: positiveInt(30_000),
  DATABASE_QUERY_TIMEOUT_MS: positiveInt(35_000),
  DATABASE_MIGRATIONS_ON_STARTUP: booleanString,
  ALLOW_LOCAL_PROVIDER_NETWORK: booleanString,
"""
)
replace(
"""  const databaseKind = /^postgres(?:ql)?:/i.test(databaseUrl)
    ? 'postgresql' as const
    : databaseUrl.startsWith('file:')
      ? 'sqlite' as const
      : databaseUrl
        ? 'unsupported' as const
        : 'unconfigured' as const;
""",
"""  const databaseKind = /^postgres(?:ql)?:/i.test(databaseUrl)
    ? 'postgresql' as const
    : databaseUrl
      ? 'unsupported' as const
      : 'unconfigured' as const;
"""
)
replace("  if (isRailway && databaseKind === 'sqlite') warnings.push('railway_ephemeral_sqlite_database');\n", '')
replace(
"""    databaseUrl,
    databaseKind,
    databaseSslMode: env.DATABASE_SSL_MODE,
""",
"""    databaseUrl,
    databaseKind,
    databaseSslMode: env.DATABASE_SSL_MODE,
    databaseSslCa: env.DATABASE_SSL_CA,
    databasePoolMax: env.DATABASE_POOL_MAX,
    databasePoolMin: Math.min(env.DATABASE_POOL_MIN, env.DATABASE_POOL_MAX),
    databaseIdleTimeoutMs: env.DATABASE_IDLE_TIMEOUT_MS,
    databaseConnectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS,
    databaseStatementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    databaseQueryTimeoutMs: env.DATABASE_QUERY_TIMEOUT_MS,
    databaseMigrationsOnStartup: env.DATABASE_MIGRATIONS_ON_STARTUP,
    allowLocalProviderNetwork: env.ALLOW_LOCAL_PROVIDER_NETWORK,
"""
)
path.write_text(text)
