import { AnthropicAdapter } from './adapters/anthropic.adapter.js';
import { GeminiAdapter } from './adapters/gemini.adapter.js';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.adapter.js';
import { normalizeBaseUrlOnly, normalizeProviderUrls } from './base-url.js';
import { getProviderDefinition, providerRegistry } from './registry.js';
import type { NormalizedProviderConfig, ProviderAdapter } from './types.js';

const adapters = new Map<string, ProviderAdapter>();

export function providerAdapterFor(providerType: string): ProviderAdapter {
  const definition = getProviderDefinition(providerType);
  const existing = adapters.get(definition.id);
  if (existing) return existing;
  const adapter: ProviderAdapter = definition.protocol === 'anthropic'
    ? new AnthropicAdapter(definition)
    : definition.protocol === 'gemini'
      ? new GeminiAdapter(definition)
      : new OpenAICompatibleAdapter(definition);
  adapters.set(definition.id, adapter);
  return adapter;
}

export function normalizeProviderConfig(input: {
  providerType: string;
  apiKey?: string;
  baseUrl?: string | null;
  selectedModel?: string | null;
  customHeaders?: Record<string, string>;
}): NormalizedProviderConfig {
  return providerAdapterFor(input.providerType).normalizeConfig({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    selectedModel: input.selectedModel,
    customHeaders: input.customHeaders
  });
}

export {
  getProviderDefinition,
  normalizeBaseUrlOnly,
  normalizeProviderUrls,
  providerRegistry
};
export type { ProviderAdapter, ProviderDefinition } from './types.js';
export type * from './types.js';
