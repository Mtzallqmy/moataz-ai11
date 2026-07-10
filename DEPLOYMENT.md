# Railway and Supabase deployment — phase 1

## Preconditions

1. Use Node.js 20 or the included Dockerfile.
2. Configure a PostgreSQL/Supabase server connection; do not rely on SQLite on Railway's ephemeral filesystem.
3. Keep `ALLOW_SHELL=false` and `SHELL_SANDBOX_MODE=disabled`. This revision intentionally refuses in-process production shell access.
4. Generate independent random values of at least 32 characters for `JWT_SECRET` and `ENCRYPTION_KEY`.
5. Do not paste `.env.example` unchanged into Railway. It is a local-development template.

## Railway variables

Set at least:

```env
NODE_ENV=production
APP_URL=https://YOUR-SERVICE.up.railway.app
CORS_ORIGIN=https://YOUR-SERVICE.up.railway.app
JWT_SECRET=<random 32+ characters>
JWT_ACCESS_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000
ENCRYPTION_KEY=<different random 32+ characters>
DATABASE_URL=<Supabase/Railway PostgreSQL pooler URL>
DATABASE_SSL_MODE=require
DEFAULT_ADMIN_EMAIL=<initial admin email>
DEFAULT_ADMIN_PASSWORD=<strong initial password, 12+ characters>
WORKSPACE_DIR=/app/workspace
ALLOW_SHELL=false
SHELL_SANDBOX_MODE=disabled
TELEGRAM_POLLING=false
TRUST_PROXY=1
```

Railway normally supplies `PORT` and its own `RAILWAY_*` reference variables. The application now detects Railway independently of `NODE_ENV`, forces production security behavior, derives the public origin from `RAILWAY_PUBLIC_DOMAIN` when `APP_URL` was accidentally left on localhost, and forces exactly one trusted proxy hop. This prevents `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` from `express-rate-limit`.

Still set `NODE_ENV=production`, `APP_URL`, `CORS_ORIGIN`, and `TRUST_PROXY=1` explicitly so the deployment configuration remains understandable and portable.

Never expose a Supabase service-role key to the browser. This application connects through `DATABASE_URL` on the server.

## Remove copied local values

If you previously copied `.env.example` into Railway, replace these values:

```env
NODE_ENV=development                 # replace with production
APP_URL=http://localhost:5173        # replace with the Railway public URL
CORS_ORIGIN=http://localhost:5173    # replace with the Railway public URL
TRUST_PROXY=false                    # replace with 1
DATABASE_URL=file:./data/moataz.db   # replace with PostgreSQL/Supabase
DATABASE_SSL_MODE=disable            # normally replace with require
WORKSPACE_DIR=./workspace            # replace with /app/workspace
```

The application logs safe configuration warning codes when it has to correct a Railway setting. It never logs secrets or the database connection string.

## Supabase connection choice

For a long-running Railway service, use the Supabase pooler URL recommended for your deployment mode. Set `DATABASE_SSL_MODE=require` unless your certificate setup supports `verify-full`. The application never infers insecure TLS behavior from the hostname and never logs `DATABASE_URL`.

Phase 1 still uses compatibility migrations in `server/src/db.ts`. Before the first deployment, run against the target database from a trusted environment:

```bash
npm ci
npm run db:migrate
npm run db:check
```

The Drizzle migration history and final normalized schema are phase-2 work and must be completed before calling the database layer final.

## Persistent data

- PostgreSQL/Supabase must be the production source of truth.
- `/app/data` and `/app/workspace` are inside the container unless a Railway Volume is mounted.
- A SQLite database in `/app/data` can disappear on redeploy or replica replacement.
- Workspace files also require a Railway Volume or external object storage if they must survive redeployments.

When Railway is detected with SQLite, the server emits:

```text
configuration_warning code=railway_ephemeral_sqlite_database
```

This is a warning rather than a startup failure so the service remains diagnosable, but it must be resolved before production use.

## Docker

```bash
docker build -t moataz-ai:1.2.0 .
docker run --rm -p 8080:8080 \
  -e NODE_ENV=production \
  -e APP_URL=https://app.example.com \
  -e CORS_ORIGIN=https://app.example.com \
  -e TRUST_PROXY=1 \
  -e JWT_SECRET='<random 32+ characters>' \
  -e ENCRYPTION_KEY='<different random 32+ characters>' \
  -e DEFAULT_ADMIN_EMAIL='admin@example.com' \
  -e DEFAULT_ADMIN_PASSWORD='<strong password>' \
  -e DATABASE_URL='<postgresql URL>' \
  -e DATABASE_SSL_MODE=require \
  -e ALLOW_SHELL=false \
  moataz-ai:1.2.0
```

The image runs as the `node` user and starts `dist/server/index.js`. Its healthcheck calls `/api/health`. Readiness is separately available at `/api/ready`.

## Post-deployment checks

```text
GET  /api/health       -> 200 { ok: true, status: "alive" }
GET  /api/ready        -> 200 with database=true and migrations=true
GET  /api/unknown      -> JSON 404, not index.html
POST /api/auth/login   -> access token plus Secure HttpOnly refresh cookie
GET  /api/auth/me      -> current active user
```

Also verify:

- An unknown `Origin` receives 403 in production.
- `/api/system/status` exposes no secrets or connection strings.
- Startup logs show `deploymentPlatform=railway`, `nodeEnv=production`, and `trustProxy=1`.
- `/api/health` and `/api/ready` are not counted against the user API rate limit.
- No `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` messages appear.

## Rollback

Database schema changes in phase 1 are additive compatibility changes. Back up the production database before migration; a source rollback does not automatically remove newly added columns or tables.
