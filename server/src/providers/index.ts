import { AnthropicAdapter } from './adapters/anthropic.adapter.js';
import { GeminiAdapter } from './adapters/gemini.adapter.js';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.adapter.js';
import { normalizeBaseUrlOnly, normalizeProviderUrls } from './base-url.js';
import { getProviderDefinition, providerRegistry } from './registry.js';
import type { NormalizedProviderConfig, ProviderAdapter, ProviderProtocol } from './types.js';

const adapters = new Map<string, ProviderAdapter>();

export function providerAdapterFor(providerType: string, protocol?: ProviderProtocol): ProviderAdapter {
  const definition = getProviderDefinition(providerType, protocol);
  const key = `${definition.id}:${definition.protocol}`;
  const existing = adapters.get(key);
  if (existing) return existing;
  const adapter: ProviderAdapter = definition.protocol === 'anthropic'
    ? new AnthropicAdapter(definition)
    : definition.protocol === 'gemini'
      ? new GeminiAdapter(definition)
      : new OpenAICompatibleAdapter(definition);
  adapters.set(key, adapter);
  return adapter;
}

export function normalizeProviderConfig(input: {
  providerType: string;
  protocol?: ProviderProtocol | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | null | undefined;
  selectedModel?: string | null | undefined;
  customHeaders?: Record<string, string> | undefined;
  userId?: string | undefined;
  providerId?: string | undefined;
  credentialVersion?: number | undefined;
}): NormalizedProviderConfig {
  return providerAdapterFor(input.providerType, input.protocol).normalizeConfig({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    selectedModel: input.selectedModel,
    customHeaders: input.customHeaders,
    userId: input.userId,
    providerId: input.providerId,
    credentialVersion: input.credentialVersion
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
