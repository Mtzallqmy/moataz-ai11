import { createHash } from 'node:crypto';
import type { ModelDiscoveryResult, NormalizedProviderConfig } from './types.js';

type CacheEntry = { expiresAt: number; value: ModelDiscoveryResult; providerId?: string };

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function providerModelCacheKey(config: NormalizedProviderConfig): string {
  const connectionFingerprint = digest([
    config.userId ?? 'anonymous',
    config.providerId ?? config.providerType,
    config.protocol,
    config.normalizedBaseUrl ?? 'default',
    String(config.credentialVersion),
    digest(config.apiKey)
  ].join('\u0000'));
  return `provider-models:${connectionFingerprint}`;
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
  return {
    ...entry.value,
    models: entry.value.models.map((model) => ({ ...model })),
    fromCache: true
  };
}

export function setCachedModels(
  key: string,
  value: ModelDiscoveryResult,
  providerId?: string,
  ttlMs = DEFAULT_TTL_MS
): void {
  cache.set(key, {
    expiresAt: Date.now() + Math.max(1_000, ttlMs),
    value: { ...value, models: value.models.map((model) => ({ ...model })), fromCache: false },
    ...(providerId ? { providerId } : {})
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

export function clearProviderModelCacheForProvider(providerId: string): void {
  for (const [key, entry] of cache) {
    if (entry.providerId === providerId) cache.delete(key);
  }
}
