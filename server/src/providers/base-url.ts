import { AppError } from '../errors.js';
import { getProviderDefinition } from './registry.js';
import type { NormalizedBaseUrl, ProviderDefinition } from './types.js';

const terminalResources = [
  '/chat/completions',
  '/completions',
  '/responses',
  '/models'
] as const;

function trimKnownResource(pathname: string): string {
  let path = pathname.replace(/\/+$/, '');
  let changed = true;
  while (changed) {
    changed = false;
    for (const resource of terminalResources) {
      if (path.toLowerCase().endsWith(resource)) {
        path = path.slice(0, -resource.length).replace(/\/+$/, '');
        changed = true;
        break;
      }
    }
  }
  return path || '/';
}

function absoluteHttpUrl(raw: string): URL {
  const value = raw.trim();
  if (!value) throw new AppError('provider_base_url_required', 422, 'A provider Base URL is required.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('provider_base_url_invalid', 422, 'The provider Base URL must be an absolute HTTP or HTTPS URL.', {
      status: 'invalid_base_url', retryable: false
    });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError('provider_unsupported_protocol', 422, 'Only HTTP and HTTPS provider URLs are supported.', {
      status: 'unsupported_protocol', retryable: false
    });
  }
  if (url.username || url.password) {
    throw new AppError('provider_base_url_invalid', 422, 'Credentials must not be embedded in the Base URL.', {
      status: 'invalid_base_url', retryable: false
    });
  }
  url.hash = '';
  url.search = '';
  url.pathname = trimKnownResource(url.pathname);
  return url;
}

function appendPath(baseUrl: string, resource: string | null): string | null {
  if (!resource) return null;
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  const normalizedResource = resource.replace(/^\/+/, '');
  const lowerBase = basePath.toLowerCase();
  const lowerResource = `/${normalizedResource.toLowerCase()}`;
  if (lowerBase.endsWith(lowerResource)) return base.toString().replace(/\/+$/, '');
  base.pathname = `${basePath}/${normalizedResource}`.replace(/\/{2,}/g, '/');
  return base.toString().replace(/\/+$/, '');
}

function hasVersionSuffix(baseUrl: string): boolean {
  const path = new URL(baseUrl).pathname.replace(/\/+$/, '');
  return /\/(?:v\d+(?:beta\d*)?|openai\/v\d+)$/i.test(path);
}

export function normalizeProviderBaseUrl(rawBaseUrl: string): string {
  return absoluteHttpUrl(rawBaseUrl).toString().replace(/\/+$/, '');
}

export function resolveProviderUrls(
  providerType: string,
  suppliedBaseUrl?: string | null
): NormalizedBaseUrl {
  const definition = getProviderDefinition(providerType);
  const raw = suppliedBaseUrl?.trim() || definition.defaultBaseUrl || '';
  if (!raw) throw new AppError('provider_base_url_required', 422, 'A provider Base URL is required.');
  if (!definition.allowsCustomBaseUrl && suppliedBaseUrl?.trim()) {
    const supplied = normalizeProviderBaseUrl(suppliedBaseUrl);
    const canonical = definition.defaultBaseUrl ? normalizeProviderBaseUrl(definition.defaultBaseUrl) : supplied;
    if (new URL(supplied).origin !== new URL(canonical).origin) {
      throw new AppError('provider_base_url_not_allowed', 422, 'This provider does not allow a custom host.', {
        status: 'invalid_base_url', retryable: false
      });
    }
  }
  const normalizedBaseUrl = normalizeProviderBaseUrl(raw);
  const models: string[] = [];
  const primaryModels = appendPath(normalizedBaseUrl, definition.endpoints.models);
  if (primaryModels) models.push(primaryModels);
  if (definition.id === 'custom' && !hasVersionSuffix(normalizedBaseUrl)) {
    const fallback = appendPath(normalizedBaseUrl, 'v1/models');
    if (fallback && !models.includes(fallback)) models.push(fallback);
  }
  return {
    rawBaseUrl: raw,
    normalizedBaseUrl,
    resolvedModelsUrls: models,
    resolvedChatUrl: appendPath(normalizedBaseUrl, definition.endpoints.chatCompletions),
    resolvedResponsesUrl: appendPath(normalizedBaseUrl, definition.endpoints.responses)
  };
}

export function providerCatalogEntry(definition: ProviderDefinition) {
  return {
    id: definition.id,
    label: definition.displayName,
    displayName: definition.displayName,
    adapter: definition.protocol,
    protocol: definition.protocol,
    defaultBaseUrl: definition.defaultBaseUrl,
    baseUrlRequired: definition.defaultBaseUrl === null,
    apiKeyRequired: definition.apiKeyRequired,
    modelExamples: definition.modelExamples,
    endpoints: definition.endpoints,
    capabilities: definition.capabilities,
    allowsCustomBaseUrl: definition.allowsCustomBaseUrl,
    localConnection: definition.localConnection
  };
}
