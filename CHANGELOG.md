# Changelog

All notable changes are documented here. The project version is synchronized with `package.json`.

## [1.6.0] — 2026-07-12

### Unified provider runtime and NaraRouter

- Added NaraRouter as an explicit OpenAI-compatible provider at `https://router.bynara.id/v1`, using actual model IDs returned by the current credential.
- Persisted provider protocol, credential version, safe encrypted custom headers, streaming preference, key last-four mask, detailed validation state, and safe request diagnostics.
- Centralized Base URL normalization without implicit `/v1`, duplicate endpoints, URL credentials, query strings, or unsafe protocols.
- Added SDK-first model discovery, direct-fetch fallback, manual model testing when `/models` is unsupported, user/provider/credential-scoped cache invalidation, and exact provider-model ownership checks.
- Replaced broad billing/key guesses with normalized HTTP, provider-code, request-ID, Retry-After, network, timeout, malformed-response, and mid-stream diagnostics.
- Added real SSE chat streaming, cancellation, idempotency, partial/failed persistence, Unicode-safe parsing, `[DONE]` validation, and streamed tool-call assembly.
- Added native Anthropic and Gemini streaming while preserving their protocol-specific message conversion.
- Added production HTTPS/private-network protections for custom providers and an explicit non-production local-provider policy for Ollama, LM Studio, and vLLM.
- Added a secret-safe `diagnose:provider` command and expanded unit/integration coverage for NaraRouter, URLs, errors, discovery, credentials, ownership, cache rotation, SSE, persistence, and audit redaction.

## [1.5.1] — 2026-07-12

### Railway production recovery

- Removed an incomplete, unused Drizzle layer that imported missing packages and referenced absent configuration, which directly broke TypeScript and Railway builds.
- Moved `better-sqlite3` to development-only dependencies, dynamically loaded it only for local SQLite, and prevented lifecycle compilation in the PostgreSQL production image.
- Required PostgreSQL in production, added SSL CA validation, pool/timeouts, connection retry, safer idempotent migrations, and migration readiness logging.
- Changed Railway and Docker healthchecks to `/api/ready`, updated the Railway schema URL, and added explicit Dockerfile configuration.
- Fixed provider Base URL normalization for hostnames, full endpoint URLs, and known-provider root URLs.
- Removed temporary branch mutation/audit workflows and updated deployment documentation and diagnostics.

## [1.5.0] — 2026-07-11

### Provider recovery, sessions, attachments, and multi-agent execution

- Replaced fragile OpenAI-compatible SDK URL composition with validated direct HTTP transport and precise upstream response parsing.
- Added automatic model discovery, candidate scoring, real model probes, fallback selection, and chat recovery when a saved model becomes unavailable.
- Reserved HTTP 401 for Moataz AI sessions; provider and integration authentication failures no longer log users out.
- Preserved authenticated UI state during transient network failures and required explicit user confirmation before logout.
- Added persistent chat uploads for text/code, images, ZIP archives, and binary files with size limits, workspace isolation, SHA-256 metadata, image model input, text extraction, and ZIP manifests.
- Added an opt-in multi-agent chat mode using up to three verified providers with bounded independent analysis and synthesis.
- Added a confirmed generic public HTTP API tool with SSRF protection, response limits, and structured errors.
- Expanded production diagnostics for invalid URLs, endpoint construction, model attempts, billing, authorization, network, and retryability.

## [1.4.0] — 2026-07-11

### Telegram console and provider diagnostics

- Added a Telegram inline control panel, registered bot commands, provider selection, chat/agent mode, status, diagnostics, workspace file listing/reading, web search/fetch, GitHub repository inspection, tool confirmation, and direct links into the web dashboard.
- Persisted per-Chat-ID Telegram provider and mode preferences in encrypted integration metadata while keeping conversation context bounded in memory.
- Added explicit API diagnostics for authentication, authorization, model access, billing/credits, rate limits, network, timeout, service availability, and model-list support.
- Added honest free/paid reporting: successful requests prove current access but do not guess the plan when the provider does not expose it; explicit billing errors are shown as credits/payment required.
- Changed provider setup to Save & verify so valid keys become usable immediately and failed keys remain saved with actionable diagnostics.
- Added capability status to the dashboard and direct `?page=` navigation used by Telegram buttons.
- Improved provider cards, diagnostics, capability cards, mobile actions, typography, spacing, status colors, and responsive layouts.

## [1.3.0] — 2026-07-11

### Provider platform v2

- Added a central provider catalog with editable presets for OpenAI, OpenRouter, Anthropic, Gemini, NVIDIA NIM, Hugging Face Router, Groq, Together, DeepSeek, Mistral, xAI, Cerebras, SambaNova, Fireworks, DeepInfra, Perplexity, Ollama, and arbitrary OpenAI-compatible endpoints.
- Added real model discovery through the OpenAI-compatible `/models` API while retaining manual model entry for providers that do not expose a model list.
- Required successful provider verification before chat or Telegram can use a provider.
- Added official function/tool calling for OpenAI-compatible providers, with a bounded agent loop and legacy fallback for providers without native tool calling.
- Added safe public-page fetching with redirect, timeout, response-size, protocol, credential, DNS, and private-address checks.
- Added Brave Search and Tavily integrations and a `web_search` agent tool.
- Reworked Telegram polling so verified bots start in discovery mode when no chat ID is configured, persist discovered chats, show the Chat ID to the user, and allow chats to be approved from the interface.
- Added explicit `allowAllChats` support with a warning and restricted Telegram processing to verified AI providers.
- Added a verified external-sandbox integration contract and production terminal execution through that sandbox; in-process Railway shell execution remains disabled.
- Expanded structured upstream errors, provider/integration UI, responsive layouts, model suggestions, Telegram discovery controls, and terminal diagnostics.
- Added provider-catalog, network-guard, Telegram discovery, and sandbox regression coverage.

### Previous production hardening

- Separated provider and integration persistence from paid validation and added encrypted stored credentials with explicit status.
- Added structured upstream error mapping for authentication, authorization, billing, missing models, rate limits, timeouts, network failures, and outages.
- Added update/test/delete flows, stale-provider recovery, per-chat provider/model/mode selection, and responsive mobile navigation.

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
- Streaming responses, cancellation, resumable persisted agent checkpoints, and provider-native tools for Anthropic/Gemini remain future work.
- The external sandbox service is a separate security boundary and is not bundled into the Railway application container.
