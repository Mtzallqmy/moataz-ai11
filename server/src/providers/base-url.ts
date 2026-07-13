import { AppError } from '../errors.js';
import { getProviderDefinition } from './registry.js';
import type { NormalizedProviderUrl, ProviderDefinition } from './types.js';

const terminalResources = [
  /\/chat\/completions$/i,
  /\/completions$/i,
  /\/responses$/i,
  /\/models$/i
] as const;

function withProtocol(value: string): string {
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function removeKnownTerminalResources(pathname: string): string {
  let current = pathname.replace(/\/+$/, '') || '/';
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of terminalResources) {
      if (!pattern.test(current)) continue;
      current = current.replace(pattern, '').replace(/\/+$/, '') || '/';
      changed = true;
      break;
    }
  }
  return current;
}

export function normalizeBaseUrlValue(value: string): string {
  let url: URL;
  try {
    url = new URL(withProtocol(value));
  } catch {
    throw new AppError('provider_base_url_invalid', 422, 'The provider Base URL must be an absolute HTTP or HTTPS URL.', {
      status: 'invalid_base_url', retryable: false
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('provider_unsupported_protocol', 422, 'Only HTTP and HTTPS provider URLs are supported.', {
      status: 'unsupported_protocol', retryable: false
    });
  }
  if (url.username || url.password) {
    throw new AppError('provider_base_url_invalid', 422, 'Credentials must not be embedded in the Base URL.', {
      status: 'invalid_base_url', retryable: false
    });
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  url.pathname = removeKnownTerminalResources(url.pathname);
  return url.toString().replace(/\/+$/, '');
}

function joinEndpoint(baseUrl: string, resource: string | null): string | null {
  if (!resource) return null;
  const cleanResource = resource.replace(/^\/+/, '');
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const suffix = `/${cleanResource}`;
  if (cleanBase.toLowerCase().endsWith(suffix.toLowerCase())) return cleanBase;
  return `${cleanBase}${suffix}`;
}

function hasVersionSegment(baseUrl: string): boolean {
  const pathname = new URL(baseUrl).pathname;
  return /\/(?:v\d+(?:beta\d*)?|api\/v\d+)(?:\/|$)/i.test(pathname);
}

function modelUrls(definition: ProviderDefinition, baseUrl: string): string[] {
  if (!definition.endpoints.models) return [];
  const primary = joinEndpoint(baseUrl, definition.endpoints.models)!;
  if (definition.id !== 'custom' || hasVersionSegment(baseUrl)) return [primary];
  const fallback = joinEndpoint(`${baseUrl}/v1`, definition.endpoints.models)!;
  return primary === fallback ? [primary] : [primary, fallback];
}

export function normalizeProviderUrl(type: string, supplied?: string | null): NormalizedProviderUrl {
  const definition = getProviderDefinition(type);
  const raw = supplied?.trim() || definition.defaultBaseUrl;
  if (!raw) {
    return {
      rawBaseUrl: supplied?.trim() || null,
      normalizedBaseUrl: null,
      resolvedModelsUrls: [],
      resolvedChatUrl: null,
      resolvedResponsesUrl: null
    };
  }
  const normalizedBaseUrl = normalizeBaseUrlValue(raw);
  return {
    rawBaseUrl: supplied?.trim() || definition.defaultBaseUrl,
    normalizedBaseUrl,
    resolvedModelsUrls: modelUrls(definition, normalizedBaseUrl),
    resolvedChatUrl: joinEndpoint(normalizedBaseUrl, definition.endpoints.chatCompletions),
    resolvedResponsesUrl: joinEndpoint(normalizedBaseUrl, definition.endpoints.responses)
  };
}

export function normalizeOptionalBaseUrl(value: string | null | undefined): string | undefined {
  return value?.trim() ? normalizeBaseUrlValue(value) : undefined;
}
