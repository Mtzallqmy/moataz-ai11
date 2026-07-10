# Changelog

All notable changes are documented here. The project version is synchronized with `package.json`.

## Unreleased — production provider and UX hardening

- Separated provider persistence from paid upstream validation; providers are saved as `untested` and tested explicitly.
- Added structured upstream error mapping for authentication, authorization, billing/credits, missing models, rate limits, timeouts, network failures, and provider outages.
- Added persisted provider and integration validation status, error code, and validation timestamp through additive compatibility migrations.
- Added provider update/test/delete behavior and safely detached deleted providers from conversations.
- Added per-conversation provider, model, and chat/agent mode selection with clearer recovery from stale provider references.
- Separated GitHub/Telegram token persistence from validation, normalized token formats, and added real identity checks.
- Restricted tools and Telegram polling to verified integrations and added dynamic Telegram bot reload after validation, edits, or deletion.
- Added Telegram allowed-chat-ID handling and safer polling startup/error isolation.
- Reorganized the React interface into focused pages, improved mobile navigation and layout, added status badges, structured error messages, request IDs, and a terminal availability check.
- Added regression coverage for upstream error classification, provider persistence without upstream billing, integration persistence, token normalization, and Telegram API error payloads.

## [1.2.0] — 2026-07-10

### Phase 0 — measurable baseline

- Preserved the original source in a dedicated Git baseline branch and backup archive.
- Recorded the original file tree and the unmodified install/build failures under `reports/baseline/`.
- Added a valid lockfile, `.gitignore`, `.dockerignore`, Node 20 engine declaration, CI, and standard scripts for linting, type checking, unit/integration tests, build, start, and database checks.
- Added strict TypeScript configs for client and server and ESLint flat configuration.

### Phase 1 — build, runtime, authentication, terminal, files, and messages

- Added the Express 4, PostgreSQL, and SQLite type packages; corrected SQLite typing; retained strict TypeScript without `skipLibCheck`.
- Added a Node 20 multi-stage Dockerfile with `npm ci`, non-root runtime, healthcheck, direct Node entrypoint, and production-only dependencies.
- Added validated environment configuration, proxy handling, production CSP, fail-closed CORS, API JSON 404, global safe errors, request IDs, structured redacted logging, liveness/readiness/status endpoints, and graceful shutdown.
- Reworked authentication with normalized email, generic credential failures, async bcrypt, active-user database checks, login throttling, last-login tracking, short access tokens, hashed rotating refresh tokens, an `HttpOnly` cookie, and `/api/auth/me`.
- Replaced WebSocket JWT query authentication with short-lived single-use tickets, origin checks, connection/session/input limits, heartbeat, structured JSON events, role rechecks, and process cleanup.
- Disabled shell execution by default and in all production deployments. The tool returns `shell_unavailable` unless a trusted local-only mode is explicitly selected.
- Rebuilt workspace path resolution for existing and new paths, symlink/traversal prevention, protected secret paths, regular-file checks, atomic writes, directory creation, deletion, rename, stat, and bounded recursive listing.
- Corrected chat context duplication, added idempotency keys and per-chat execution locking, separated tool results from user messages, normalized tool-call records, redacted tool data, and fixed frontend optimistic-message reconciliation.
- Added unit and integration coverage for configuration, auth, redaction, tool-call compatibility, message context, protected file operations, workspace isolation, login/session behavior, ticket use, cross-user access, and JSON API 404 behavior.
- Updated `node-telegram-bot-api` and Vitest; `npm audit` reports zero known vulnerabilities at delivery time.

### Deferred

- Drizzle/PostgreSQL migrations and removal of the SQLite compatibility layer (phase 2).
- Formal provider-specific tool calling, streaming, full persisted agent loop, cancellation, and SSRF controls (phase 3).
- Full feature-based frontend split and phase-4 UX scope.
