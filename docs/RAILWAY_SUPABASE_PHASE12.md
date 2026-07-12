# Railway and Supabase Deployment — Phases 1–2

## Required Railway variables

Add values in Railway. Do not commit values to Git.

```env
NODE_ENV
APP_URL
CORS_ORIGIN
TRUST_PROXY
JWT_SECRET
ENCRYPTION_KEY
DATABASE_URL
DATABASE_SSL_MODE
DATABASE_POOL_MAX
DATABASE_IDLE_TIMEOUT_MS
DATABASE_CONNECTION_TIMEOUT_MS
DATABASE_STATEMENT_TIMEOUT_MS
DATABASE_STARTUP_RETRIES
DATABASE_MIGRATIONS_ON_STARTUP
DEFAULT_ADMIN_EMAIL
DEFAULT_ADMIN_PASSWORD
WORKSPACE_DIR
ALLOW_SHELL
SHELL_SANDBOX_MODE
TELEGRAM_POLLING
LOG_LEVEL
PROVIDER_DISCOVERY_TIMEOUT_MS
PROVIDER_REQUEST_TIMEOUT_MS
PROVIDER_MAX_RESPONSE_BYTES
PROVIDER_MAX_REDIRECTS
PROVIDER_MODEL_CACHE_TTL_MS
ALLOW_PRIVATE_PROVIDER_URLS
```

Railway supplies `PORT` and `RAILWAY_*` variables automatically.

## Supabase connection

Use a PostgreSQL URI from Supabase. Do not include square brackets around the password. Percent-encode special characters in the password.

For a long-running Railway service, prefer the Supabase direct connection when IPv6 connectivity is available, or the session pooler when it is not. Do not use the transaction pooler for application behavior that depends on session-level settings.

Typical values:

```env
DATABASE_SSL_MODE=require
DATABASE_MIGRATIONS_ON_STARTUP=false
```

`require` encrypts the connection but accepts the platform certificate chain without hostname verification. Use `verify-full` only when the runtime has the correct CA chain and the supplied hostname matches the certificate.

## Migration deployment

Preferred production sequence:

1. deploy a release job or temporary Railway command with the same image;
2. run `npm run db:migrate:prod` once from the built production image;
3. run `npm run db:check:prod`;
4. deploy/start the web service with `DATABASE_MIGRATIONS_ON_STARTUP=false`;
5. verify `/api/ready` returns HTTP 200.

For a single-replica trial deployment, `DATABASE_MIGRATIONS_ON_STARTUP=true` is supported. Set it back to `false` after the migration is applied when moving to multiple replicas.

## Provider keys

AI provider keys, Telegram bot tokens, GitHub tokens, search tokens, and sandbox tokens are entered through the authenticated application UI and stored encrypted in PostgreSQL. They are not Railway environment variables.

A provider remains a draft until a real inference request succeeds. A successful `/models` response alone does not mark it ready.

## Security requirements

- Never expose `DATABASE_URL`, Supabase service-role keys, or encrypted secrets in `VITE_` variables.
- Keep `ALLOW_PRIVATE_PROVIDER_URLS=false` in production unless a reviewed private provider route is required.
- Keep `ALLOW_SHELL=false`; command execution belongs in the separately verified external sandbox.
- Use one Telegram polling replica for a bot token.
- Rotate any API key, database password, or GitHub token that has appeared in logs, screenshots, or chat messages.
