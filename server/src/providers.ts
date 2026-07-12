import { AppError } from './errors.js';
import {
  getProviderDefinition,
  normalizeBaseUrlOnly,
  normalizeProviderUrls,
  providerRegistry
} from './providers/index.js';

export type ProviderAdapter = 'openai' | 'openai-compatible' | 'anthropic' | 'gemini';

export type ProviderCatalogEntry = {
  id: string;
  label: string;
  adapter: ProviderAdapter;
  protocol: ProviderAdapter;
  defaultBaseUrl: string | null;
  baseUrlRequired: boolean;
  apiKeyRequired: boolean;
  modelExamples: readonly string[];
  capabilities: ReturnType<typeof getProviderDefinition>['capabilities'];
  allowBaseUrlOverride: boolean;
};

export const providerCatalog: readonly ProviderCatalogEntry[] = providerRegistry.map((definition) => ({
  id: definition.id,
  label: definition.displayName,
  adapter: definition.protocol,
  protocol: definition.protocol,
  defaultBaseUrl: definition.defaultBaseUrl,
  baseUrlRequired: definition.defaultBaseUrl === null,
  apiKeyRequired: definition.apiKeyRequired,
  modelExamples: definition.modelExamples,
  capabilities: definition.capabilities,
  allowBaseUrlOverride: definition.allowBaseUrlOverride
}));

export function providerDefinition(type: string): ProviderCatalogEntry {
  const definition = getProviderDefinition(type);
  return {
    id: definition.id,
    label: definition.displayName,
    adapter: definition.protocol,
    protocol: definition.protocol,
    defaultBaseUrl: definition.defaultBaseUrl,
    baseUrlRequired: definition.defaultBaseUrl === null,
    apiKeyRequired: definition.apiKeyRequired,
    modelExamples: definition.modelExamples,
    capabilities: definition.capabilities,
    allowBaseUrlOverride: definition.allowBaseUrlOverride
  };
}

export function providerAdapter(type: string): ProviderAdapter {
  return getProviderDefinition(type).protocol;
}

export function normalizeBaseUrl(value: string | undefined | null): string | undefined {
  if (!value?.trim()) return undefined;
  return normalizeBaseUrlOnly(value);
}

export function resolveProviderBaseUrl(type: string, supplied: string | undefined | null): string | undefined {
  const definition = getProviderDefinition(type);
  const urls = normalizeProviderUrls(definition, supplied);
  return urls.normalizedBaseUrl ?? undefined;
}

export function assertProviderCredentials(type: string, apiKey: string, baseUrl: string | undefined): void {
  const definition = getProviderDefinition(type);
  if (definition.apiKeyRequired && !apiKey.trim()) {
    throw new AppError('provider_api_key_required', 422, 'An API key is required for this provider.');
  }
  const urls = normalizeProviderUrls(definition, baseUrl);
  if (!urls.normalizedBaseUrl) {
    throw new AppError('provider_base_url_required', 422, 'A Base URL is required for this provider.');
  }
}
