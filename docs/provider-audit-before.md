# Provider pipeline audit — before implementation

Date: 2026-07-12

## Request path traced

1. `client/src/pages/ProvidersPage.tsx` builds a draft provider payload and calls `/api/providers/models`, `/api/providers/test`, then `/api/providers/:id/test` after saving.
2. `server/src/routes.ts` validates the payload, normalizes the URL through `resolveProviderBaseUrl`, encrypts the key in `providers.api_key_enc`, and invokes `diagnoseProviderConnection`.
3. `server/src/llm.ts` selects an adapter from `server/src/providers/index.ts` and performs discovery/inference.
4. `server/src/providers/adapters/openai-compatible.adapter.ts` currently performs direct fetch discovery and non-streaming Chat Completions.
5. `client/src/pages/ChatPage.tsx` saves provider/model on the chat, then posts only message content to `/api/chats/:id/messages` and waits for a buffered JSON response.

## Confirmed root causes and risks

- **NaraRouter is not registered**: `server/src/providers/registry.ts` has no `nararouter` entry, so the UI cannot present the required preset and unknown types inherit the generic custom definition.
- **No explicit protocol persisted**: `server/src/db.ts` stores provider `type` but not the selected protocol. Adapter selection is inferred from the registry, making arbitrary custom provider names ambiguous.
- **Base URL quote handling is incomplete**: `server/src/providers/base-url.ts:22-28` trims whitespace but does not remove surrounding quotes before `new URL()`. A pasted quoted URL can be normalized incorrectly.
- **HTTP is allowed for public custom endpoints in production**: `server/src/network.ts:47` accepts both HTTP and HTTPS; only private IPs are blocked. SaaS custom providers should require HTTPS unless an explicit local-provider policy is enabled.
- **Discovery does not follow the requested SDK-first pipeline**: `server/src/providers/adapters/openai-compatible.adapter.ts:195-244` uses direct fetch only; it does not attempt `client.models.list()` first.
- **Connection probes use too few output tokens**: `server/src/providers/adapters/openai-compatible.adapter.ts:260-266`, Anthropic, and Gemini use `maxTokens: 5`, which can fail for reasoning models before visible content is emitted.
- **Model examples can become implicit fallback candidates**: `server/src/llm.ts:173-183` appends registry examples after discovered IDs. This is unsafe for custom providers and can produce misleading model/payment errors when discovery is unsupported.
- **Automatic recovery is too broad**: `server/src/routes.ts:514-545` retries model selection for authorization, billing, invalid request, and empty response. It can switch models after a non-transient policy or billing error without an explicit fallback policy.
- **Cache identity is weak**: `server/src/providers/model-cache.ts:7-9` uses provider type, URL, and visible key prefix/length/suffix. It is not scoped by user/provider/credential version and can collide.
- **Custom headers are not persisted or exposed**: adapters accept custom headers, but provider routes/schema/UI do not store them, so gateways requiring safe additional headers cannot work.
- **Error classification is duplicated**: `server/src/providers/diagnostics.ts` and `server/src/provider-diagnostics.ts` maintain different diagnostic shapes. The route wrapper can replace detailed adapter diagnostics with a coarser plan-oriented result.
- **403 is not separated into model-not-allowed versus generic forbidden**: `server/src/providers/diagnostics.ts:152-157` maps all 403 responses to one status.
- **No Retry-After is returned**: diagnostics read request IDs but not `retry-after`, preventing accurate rate-limit guidance.
- **No provider request audit record**: no table records safe request metadata such as endpoint path, model, latency, status, and upstream request ID.
- **No backend streaming path**: `ProviderAdapter` defines an optional stream method, but the OpenAI-compatible adapter does not implement it and `client/src/pages/ChatPage.tsx` only waits for JSON.
- **Chat send does not bind provider/model in the request**: `client/src/pages/ChatPage.tsx:263-267` sends content and attachments only. The backend relies on prior chat state, making race conditions possible after provider/model changes.
- **No cancellation**: the chat UI has no `AbortController` for a running inference request.
- **Saved provider responses do not include a key mask**: the API correctly omits the key, but the UI cannot distinguish whether a credential is stored without a safe last-four indicator.
- **Test baseline is environment-fragile**: `npm run test` passes 39 pure tests but five SQLite-backed suites cannot load the native `better-sqlite3` binding under Node 22; the project declares Node 20.

## Implementation direction

Retain the existing provider architecture and strengthen it instead of creating a duplicate subsystem. Add explicit protocol/credential metadata, NaraRouter, secure URL/header normalization, SDK-first discovery, direct-fetch fallback, robust diagnostics, scoped cache invalidation, safe request logs, exact model selection, and an SSE chat path for simple chat mode.
