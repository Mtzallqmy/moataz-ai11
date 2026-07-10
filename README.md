# Moataz AI

Moataz AI is a TypeScript application with a React/Vite client and an Express server. It supports encrypted AI-provider credentials, chats, GitHub and Telegram integrations, protected workspace file tools, and an optional terminal protocol.

This repository currently contains the completed **phase 0 and phase 1 hardening work**. The Drizzle/PostgreSQL redesign, formal provider tool calling, full streaming agent runtime, and the larger frontend decomposition belong to later phases and are not represented as completed here.

## Security posture in this revision

- Access tokens are short-lived and held in frontend memory. Refresh tokens are random, hashed in the database, rotated, and delivered through an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production).
- `/api/auth/me` is the authoritative session endpoint. Every authenticated request rechecks the user, role, and active status in the database.
- WebSocket terminal authentication uses a short-lived, single-use ticket. Long-lived JWTs are not placed in WebSocket query strings.
- Shell execution is disabled by default and unavailable in production. Changing the working directory is not treated as isolation. A future production shell must run in a separate constrained worker/container.
- File operations reject absolute paths, traversal, null bytes, protected secret paths, symlink traversal, and non-regular files. Writes use a temporary file followed by an atomic rename.
- Production CORS is allowlist-based and fail-closed. Helmet CSP is enabled in production.
- Request logs are structured and redact secret-shaped fields. Provider/database internals are not returned directly to clients.

## Requirements

- Node.js **20.x**
- npm with the committed `package-lock.json`
- Native build prerequisites may be needed for `better-sqlite3` on platforms without a matching prebuilt binary. SQLite remains a temporary phase-1 development adapter; phase 2 is expected to replace the production data layer with Drizzle/PostgreSQL.

## Local setup

```bash
cp .env.example .env
npm ci
npm run db:migrate
npm run db:check
npm run dev
```

Open `http://localhost:5173`. The Vite development server proxies API and WebSocket traffic to Express.

Before committing or deploying, run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

The production process is:

```bash
npm start
```

It executes `node dist/server/index.js`, so `npm run build` must have completed first.

## Database commands

- `npm run db:generate` — reports the phase-1 compatibility migration state. Drizzle generation starts in phase 2.
- `npm run db:migrate` — applies the idempotent phase-1 compatibility migration.
- `npm run db:check` — verifies connectivity and migration status.

For local development, `DATABASE_URL=file:./data/moataz.db` selects SQLite. A PostgreSQL URL selects the existing PostgreSQL compatibility adapter. Do not treat this adapter as the final phase-2 schema/migration implementation.

## Important endpoints

- `GET /api/health` — process liveness only.
- `GET /api/ready` — database connectivity and migration readiness.
- `GET /api/system/status` — authenticated, secret-free application status.
- `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me` — session lifecycle.
- `POST /api/auth/ws-ticket` — admin-only, single-use terminal ticket; returns `shell_unavailable` unless a permitted local-development mode is active.

Unknown `/api/*` routes always return JSON 404 and are never handled by the SPA fallback.

## Terminal and shell

`ALLOW_SHELL=false` and `SHELL_SANDBOX_MODE=disabled` are the safe defaults. The only phase-1 opt-in is:

```env
ALLOW_SHELL=true
SHELL_SANDBOX_MODE=local-development
NODE_ENV=development
```

That mode is for a trusted local machine only and is explicitly **not** a security sandbox. Production ignores it. See `docs/terminal-protocol.md` for ticket authentication, JSON events, limits, and close behavior.

## Docker and Railway

The Dockerfile uses Node 20, `npm ci`, a multi-stage build, a non-root runtime user, an HTTP healthcheck, and the direct Node entrypoint. Build and deployment instructions are in `DEPLOYMENT.md`.

## Current phase boundary

The following remain intentionally deferred until phase 2 or later:

- Drizzle schema and generated migrations as the production source of truth.
- Removal of `better-sqlite3` and the legacy placeholder conversion layer.
- Complete project/workspace/file relational schema and repository layer.
- Formal tool calling adapters for each provider, streaming, cancellation, persisted multi-step agent execution, and SSRF-hardened custom providers.
- Full feature-based React decomposition and phase-4 UX work.
