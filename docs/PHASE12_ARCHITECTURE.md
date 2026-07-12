# Moataz AI — Provider and PostgreSQL Architecture

This document covers only the completed provider-system and database-layer phases.

## Provider registry

The source of truth is `server/src/providers/registry.ts`. Each definition declares:

- provider ID and display name;
- native protocol (`openai-compatible`, `anthropic`, or `gemini`);
- default Base URL;
- authentication style;
- models, chat-completions, and responses paths where known;
- capabilities using `true`, `false`, or `null` when support is unknown;
- allowed custom headers;
- whether a custom Base URL is permitted;
- whether local connections are permitted in development;
- whether an API key is required.

The registry includes OpenAI, OpenRouter, Anthropic, Google Gemini, Groq, Together AI, DeepSeek, Mistral AI, NVIDIA NIM, Hugging Face Router, Cerebras, SambaNova, Fireworks AI, DeepInfra, Perplexity, xAI, Ollama, and custom OpenAI-compatible endpoints.

Unknown capabilities are not guessed. Anthropic and Gemini use native adapters and are not routed through an OpenAI payload.

## Provider adapters

`server/src/providers/adapters/` contains protocol adapters. Common responsibilities are centralized in:

- `base-url.ts`: deterministic URL normalization and endpoint resolution;
- `http.ts`: bounded JSON and streaming HTTP transport;
- `model-response.ts`: Zod-validated model-list parsing;
- `model-discovery.ts`: bounded discovery with a short cache;
- `diagnostics.ts`: unified error classification;
- `service.ts`: real inference probes and chat/stream delegation.

A provider is usable by chat and Telegram only after a real inference probe succeeds. Saving a provider does not make it ready. Failed providers remain editable and can be retested.

## Base URL rules

Normalization:

1. trims whitespace;
2. permits only HTTP and HTTPS;
3. rejects embedded credentials;
4. removes query strings, fragments, and trailing slashes;
5. removes only known terminal API paths (`models`, `chat/completions`, `completions`, and `responses`);
6. preserves custom prefixes such as `/openai/v1` and `/api/openai/v1`;
7. never silently changes the host;
8. never blindly appends `/v1`;
9. prevents duplicate `/v1/v1` or repeated endpoint paths.

Custom discovery tests the normalized `/models` path and, only when the base has no version suffix, one `/v1/models` alternative. It does not perform arbitrary endpoint scanning.

## SSRF policy

Provider and web requests resolve DNS before connecting and validate every redirect. By default the application blocks:

- loopback and unspecified addresses;
- RFC1918 private IPv4 ranges;
- link-local and metadata endpoints;
- private, loopback, and link-local IPv6 ranges;
- public hostnames that resolve to internal addresses;
- redirects from a public endpoint to an internal endpoint.

Ollama/private targets are allowed only outside production, or when the explicit private-provider policy is enabled. A custom provider never receives an implicit private-network exception.

## Diagnostics

Diagnostics report independent values for:

- provider reachability;
- key validity;
- model availability;
- HTTP status and provider code;
- retryability;
- tested endpoint and model;
- request IDs;
- latency;
- discovery status.

Examples:

- `401` → `invalid_api_key`;
- `403` → `forbidden`;
- `404` is split into endpoint and model errors;
- `429` is split into rate limit, quota, and billing/credit errors;
- `500`–`504` do not invalidate the key;
- “No available channel for model …” → retryable `model_unavailable`;
- HTML or malformed JSON → `invalid_response`;
- DNS, TLS, network, and timeout errors are distinct.

The API returns a redacted structured error envelope. API keys, authorization headers, refresh tokens, JWTs, database URLs, and encrypted secrets are not returned.

## PostgreSQL and Drizzle

Production uses PostgreSQL only. The runtime no longer loads SQLite or `better-sqlite3`.

- schema: `server/src/database/schema.ts`;
- pool and health checks: `server/src/database/client.ts`;
- migration runner: `server/src/database/migrate.ts`;
- tracked migrations: `drizzle/`;
- typed repositories: `server/src/repositories/`;
- Drizzle Kit configuration: `drizzle.config.ts`.

The backend is the only database client. Supabase service-role keys and `DATABASE_URL` must never be placed in frontend or `VITE_` variables.

## Tables

The migration contains:

- `users`;
- `refresh_tokens`;
- `providers`;
- `provider_models`;
- `integrations`;
- `projects`;
- `workspaces`;
- `files` (metadata only; production object storage remains a separate concern);
- `chats`;
- `messages`;
- `attachments`;
- `agent_runs`;
- `agent_steps`;
- `tool_executions`;
- `websocket_tickets`;
- `audit_logs`.

Ownership is included in repository queries. Foreign keys and cascades are explicit. Messages use a per-chat sequence and a partial unique idempotency index. A partial unique index prevents more than one running agent run per chat. WebSocket tickets and refresh tokens store hashes, not raw tokens.

## Migration strategy

`drizzle/0000_phase12_postgres.sql` is additive and data-preserving:

1. creates missing legacy tables when migrating a fresh database;
2. adds new nullable/defaulted fields;
3. backfills provider protocol, URLs, selected model, status, readiness, and diagnostics;
4. converts legacy integer booleans to PostgreSQL booleans;
5. converts legacy integration metadata and message tool calls to JSONB;
6. assigns stable message sequences;
7. backfills agent-run ownership and structured summary data;
8. adds constraints and indexes after the backfill.

It does not drop a legacy table or raw data column. Legacy compatibility columns remain until a later, separately reviewed cleanup migration. Rollback is therefore application rollback rather than destructive schema rollback.

## Commands

```bash
npm run db:generate
npm run db:migrate
npm run db:check
npm run db:studio
npm run db:seed
```

For production, run `npm run db:migrate` as a release/pre-deploy command, or explicitly set `DATABASE_MIGRATIONS_ON_STARTUP=true` for a single application replica. Do not allow several replicas to perform first-time operational setup simultaneously unless the deployment process serializes migrations.

## Removed obsolete SQLite compatibility tests

The following tests targeted the deleted dual SQLite/raw-SQL helper and were replaced by the PostgreSQL/Drizzle unit and integration suites:

- `server/src/app.integration.test.ts`
