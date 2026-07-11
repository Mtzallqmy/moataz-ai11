import { AppError } from './errors.js';
import { getProviderDefinition, providerRegistry } from './providers/registry.js';
import { normalizeBaseUrl, normalizeProviderConfig, publicProviderDefinition } from './providers/base-url.js';
import type { ProviderDefinition, ProviderProtocol } from './providers/types.js';

export type ProviderAdapter = 'openai-compatible' | 'anthropic' | 'gemini';
export type ProviderCatalogEntry = ReturnType<typeof publicProviderDefinition>;

export const providerCatalog: readonly ProviderCatalogEntry[] = providerRegistry.map(publicProviderDefinition);

export function providerDefinition(type: string): ProviderCatalogEntry {
  return publicProviderDefinition(getProviderDefinition(type));
}

export function providerProtocol(type: string): ProviderProtocol {
  return getProviderDefinition(type).protocol;
}

export function providerAdapter(type: string): ProviderAdapter {
  const protocol = providerProtocol(type);
  return protocol === 'openai-chat' ? 'openai-compatible' : protocol === 'anthropic-messages' ? 'anthropic' : 'gemini';
}

export function resolveProviderBaseUrl(type: string, supplied: string | undefined | null): string | undefined {
  const definition = getProviderDefinition(type);
  const value = supplied?.trim() || definition.defaultBaseUrl;
  return value ? normalizeBaseUrl(value).normalizedBaseUrl : undefined;
}

export function assertProviderCredentials(type: string, apiKey: string, baseUrl: string | undefined): void {
  const definition: ProviderDefinition = getProviderDefinition(type);
  if (definition.apiKeyRequired && !apiKey.trim()) throw new AppError('provider_api_key_required', 422, 'An API key is required for this provider.');
  if (definition.baseUrlRequired && !baseUrl) throw new AppError('provider_base_url_required', 422, 'A base URL is required for this provider.');
  if (baseUrl) normalizeProviderConfig({ providerType: type, apiKey, baseUrl, model: 'validation-only' });
}

export { normalizeBaseUrl };
