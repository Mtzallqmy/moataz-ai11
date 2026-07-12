import { AppError } from './errors.js';
import { normalizeProviderBaseUrl, providerCatalogEntry, resolveProviderUrls } from './providers/base-url.js';
import { getProviderDefinition, providerRegistry } from './providers/registry.js';
import type { ProviderProtocol } from './providers/types.js';

export type ProviderAdapter = ProviderProtocol;
export type ProviderCatalogEntry = ReturnType<typeof providerCatalogEntry>;

export const providerCatalog: readonly ProviderCatalogEntry[] = providerRegistry.map(providerCatalogEntry);

export function providerDefinition(type: string): ProviderCatalogEntry {
  return providerCatalogEntry(getProviderDefinition(type));
}

export function providerAdapter(type: string): ProviderAdapter {
  return getProviderDefinition(type).protocol;
}

export function normalizeBaseUrl(value: string | undefined | null): string | undefined {
  if (!value?.trim()) return undefined;
  return normalizeProviderBaseUrl(value);
}

export function resolveProviderBaseUrl(type: string, supplied: string | undefined | null): string | undefined {
  const definition = getProviderDefinition(type);
  if (definition.id === 'gemini' && supplied?.trim()) {
    let url: URL;
    try {
      url = new URL(supplied.trim());
    } catch {
      throw new AppError('provider_base_url_invalid', 422, 'The provider Base URL must be an absolute HTTP or HTTPS URL.');
    }
    if (url.hostname.toLowerCase() === 'generativelanguage.googleapis.com') return definition.defaultBaseUrl ?? undefined;
  }
  if (!supplied?.trim() && !definition.defaultBaseUrl) return undefined;
  return resolveProviderUrls(definition.id, supplied).normalizedBaseUrl;
}

export function assertProviderCredentials(type: string, apiKey: string, baseUrl: string | undefined): void {
  const definition = getProviderDefinition(type);
  if (definition.apiKeyRequired && !apiKey.trim()) {
    throw new AppError('provider_api_key_required', 422, 'An API key is required for this provider.');
  }
  if (!definition.defaultBaseUrl && !baseUrl) {
    throw new AppError('provider_base_url_required', 422, 'A Base URL is required for this provider.');
  }
  if (baseUrl) resolveProviderUrls(type, baseUrl);
}
