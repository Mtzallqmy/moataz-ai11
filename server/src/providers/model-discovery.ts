import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { adapterForProtocol } from './adapters/index.js';
import { getProviderDefinition } from './registry.js';
import type { ModelDiscoveryResult, ProviderRuntimeConfig } from './types.js';

type CacheEntry = {
  expiresAt: number;
  result: ModelDiscoveryResult;
};

const cache = new Map<string, CacheEntry>();
const maxCacheEntries = 200;

function cacheKey(input: ProviderRuntimeConfig): string {
  const secretHash = createHash('sha256').update(input.apiKey).digest('hex').slice(0, 24);
  return [input.providerType, input.normalizedBaseUrl ?? input.rawBaseUrl ?? '', secretHash].join('|');
}

function cloneResult(result: ModelDiscoveryResult, cached: boolean): ModelDiscoveryResult {
  return {
    ...result,
    cached,
    models: result.models.map((model) => ({
      ...model,
      ...(model.capabilities ? { capabilities: { ...model.capabilities } } : {})
    })),
    testedEndpoints: [...result.testedEndpoints]
  };
}

function pruneCache(now: number): void {
  for (const [key, value] of cache) {
    if (value.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= maxCacheEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export async function discoverProviderModels(
  input: ProviderRuntimeConfig,
  options: { signal?: AbortSignal | undefined; force?: boolean | undefined } = {}
): Promise<ModelDiscoveryResult> {
  const definition = getProviderDefinition(input.providerType);
  if (definition.capabilities.modelDiscovery === false || definition.endpoints.models === null) {
    return {
      status: 'unsupported',
      models: [],
      testedEndpoints: [],
      latencyMs: 0,
      cached: false,
      message: 'This provider does not expose model discovery through the configured adapter.'
    };
  }

  const normalized = adapterForProtocol(definition.protocol).normalizeConfig(input);
  const key = cacheKey(normalized);
  const now = Date.now();
  pruneCache(now);
  if (!options.force) {
    const existing = cache.get(key);
    if (existing && existing.expiresAt > now) return cloneResult(existing.result, true);
  }

  const result = await adapterForProtocol(definition.protocol).discoverModels(normalized, options.signal);
  if (result.status === 'supported') {
    cache.set(key, {
      expiresAt: now + config.providerModelCacheTtlMs,
      result: cloneResult(result, false)
    });
  }
  return cloneResult(result, false);
}

export function clearProviderModelCache(): void {
  cache.clear();
}
