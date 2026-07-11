import type { ModelDiscoveryResult } from './types.js';

type CacheEntry = { expiresAt: number; value: ModelDiscoveryResult };

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

export function providerModelCacheKey(providerType: string, normalizedBaseUrl: string | null, apiKey: string): string {
  const fingerprint = apiKey ? `${apiKey.slice(0, 3)}:${apiKey.length}:${apiKey.slice(-3)}` : 'no-key';
  return `${providerType}:${normalizedBaseUrl ?? 'default'}:${fingerprint}`;
}

export function getCachedModels(key: string): ModelDiscoveryResult | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return { ...entry.value, models: entry.value.models.map((model) => ({ ...model })), fromCache: true };
}

export function setCachedModels(key: string, value: ModelDiscoveryResult, ttlMs = DEFAULT_TTL_MS): void {
  cache.set(key, {
    expiresAt: Date.now() + Math.max(1_000, ttlMs),
    value: { ...value, models: value.models.map((model) => ({ ...model })), fromCache: false }
  });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function clearProviderModelCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}
