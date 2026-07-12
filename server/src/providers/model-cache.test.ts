import { beforeEach, describe, expect, it } from 'vitest';
import { getProviderDefinition } from '../providers/index.js';
import { clearProviderModelCache, clearProviderModelCacheForProvider, getCachedModels, providerModelCacheKey, setCachedModels } from './model-cache.js';
import type { NormalizedProviderConfig } from './types.js';

function config(overrides: Partial<NormalizedProviderConfig> = {}): NormalizedProviderConfig {
  const definition = getProviderDefinition('nararouter');
  return {
    providerType: 'nararouter', protocol: 'openai-compatible', definition,
    apiKey: 'secret-a', selectedModel: null, customHeaders: {},
    rawBaseUrl: definition.defaultBaseUrl, normalizedBaseUrl: definition.defaultBaseUrl,
    resolvedModelsUrl: `${definition.defaultBaseUrl}/models`,
    resolvedChatUrl: `${definition.defaultBaseUrl}/chat/completions`,
    resolvedResponsesUrl: null,
    userId: 'user-a', providerId: 'provider-a', credentialVersion: 1,
    ...overrides
  };
}

describe('provider model cache', () => {
  beforeEach(() => clearProviderModelCache());

  it('is scoped by user, provider, URL, credential version, and key fingerprint', () => {
    const base = providerModelCacheKey(config());
    expect(providerModelCacheKey(config({ userId: 'user-b' }))).not.toBe(base);
    expect(providerModelCacheKey(config({ providerId: 'provider-b' }))).not.toBe(base);
    expect(providerModelCacheKey(config({ normalizedBaseUrl: 'https://other.example/v1' }))).not.toBe(base);
    expect(providerModelCacheKey(config({ credentialVersion: 2 }))).not.toBe(base);
    expect(providerModelCacheKey(config({ apiKey: 'secret-b' }))).not.toBe(base);
  });

  it('returns defensive copies and invalidates all entries for a provider', () => {
    const key = providerModelCacheKey(config());
    setCachedModels(key, { status: 'supported', models: [{ id: 'model-a' }], fromCache: false }, 'provider-a');
    const cached = getCachedModels(key);
    expect(cached?.fromCache).toBe(true);
    cached!.models[0]!.id = 'mutated';
    expect(getCachedModels(key)?.models[0]?.id).toBe('model-a');
    clearProviderModelCacheForProvider('provider-a');
    expect(getCachedModels(key)).toBeUndefined();
  });
});
