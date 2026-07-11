import crypto from 'node:crypto';
import { config } from '../config.js';
import { adapterForProtocol } from './adapters/index.js';
import { getProviderDefinition } from './registry.js';
import type { ModelDiscoveryResult, ProviderRuntimeConfig } from './types.js';

type CacheEntry = { expiresAt: number; result: ModelDiscoveryResult };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ModelDiscoveryResult>>();

function cacheKey(input: ProviderRuntimeConfig): string {
  const keyFingerprint = crypto.createHash('sha256').update(input.apiKey).digest('hex').slice(0, 16);
  return [input.providerType, input.normalizedBaseUrl ?? input.rawBaseUrl ?? '', keyFingerprint].join('|');
}

function clone(result: ModelDiscoveryResult, cached: boolean): ModelDiscoveryResult {
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

export async function discoverProviderModels(
  input: ProviderRuntimeConfig,
  options: { signal?: AbortSignal; force?: boolean } = {}
): Promise<ModelDiscoveryResult> {
  const definition = getProviderDefinition(input.providerType);
  const adapter = adapterForProtocol(definition.protocol);
  const normalized = adapter.normalizeConfig(input);
  const key = cacheKey(normalized);
  const now = Date.now();
  const existing = cache.get(key);
  if (!options.force && existing && existing.expiresAt > now) return clone(existing.result, true);
  if (!options.force) {
    const active = inflight.get(key);
    if (active) return clone(await active, false);
  }
  const task = adapter.discoverModels(normalized, options.signal).then((result) => {
    const clean = clone(result, false);
    cache.set(key, { expiresAt: Date.now() + config.providerModelCacheTtlMs, result: clean });
    return clean;
  }).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return clone(await task, false);
}

export function invalidateProviderModelCache(input?: Pick<ProviderRuntimeConfig, 'providerType' | 'apiKey' | 'rawBaseUrl' | 'normalizedBaseUrl'>): void {
  if (!input) {
    cache.clear();
    inflight.clear();
    return;
  }
  const prefix = `${input.providerType}|${input.normalizedBaseUrl ?? input.rawBaseUrl ?? ''}|`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}
