import { AppError } from '../errors.js';
import { getProviderDefinition } from './registry.js';
import type { NormalizedBaseUrl } from './types.js';

const terminalPaths = [
  /\/chat\/completions$/i,
  /\/completions$/i,
  /\/responses$/i,
  /\/models$/i
] as const;

function trimTerminalPaths(pathname: string): string {
  let path = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  let changed = true;
  while (changed && path) {
    changed = false;
    for (const pattern of terminalPaths) {
      if (!pattern.test(path)) continue;
      path = path.replace(pattern, '').replace(/\/+$/, '');
      changed = true;
      break;
    }
  }
  return path === '/' ? '' : path;
}

function normalizedUrl(raw: string): URL {
  const input = raw.trim();
  if (!input) throw new AppError('provider_base_url_required', 422, 'A Base URL is required.');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('provider_base_url_invalid', 422, 'The Base URL must be an absolute HTTP or HTTPS URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('provider_unsupported_protocol', 422, 'Only HTTP and HTTPS provider URLs are supported.', {
      protocol: url.protocol,
      retryable: false
    });
  }
  if (url.username || url.password) {
    throw new AppError('provider_base_url_invalid', 422, 'Provider URLs must not contain embedded credentials.');
  }
  url.search = '';
  url.hash = '';
  url.pathname = trimTerminalPaths(url.pathname);
  return url;
}

export function normalizeProviderBaseUrl(raw: string): string {
  const url = normalizedUrl(raw);
  return `${url.origin}${url.pathname}`;
}

function joinEndpoint(base: string, endpoint: string | null): string | null {
  if (!endpoint) return null;
  const baseUrl = new URL(base);
  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  const endpointPath = endpoint.replace(/^\/+/, '');
  baseUrl.pathname = `${basePath}/${endpointPath}`.replace(/\/{2,}/g, '/');
  baseUrl.search = '';
  baseUrl.hash = '';
  return baseUrl.toString().replace(/\/$/, '');
}

function hasVersionSuffix(base: string): boolean {
  const path = new URL(base).pathname.replace(/\/+$/, '');
  return /\/(?:v\d+(?:beta\d*)?|openai)$/i.test(path);
}

export function resolveProviderUrls(providerType: string, rawBaseUrl?: string | null): NormalizedBaseUrl {
  const definition = getProviderDefinition(providerType);
  const raw = rawBaseUrl?.trim() || definition.defaultBaseUrl;
  if (!raw) throw new AppError('provider_base_url_required', 422, 'A Base URL is required for this provider.');
  const normalizedBaseUrl = normalizeProviderBaseUrl(raw);
  const models = new Set<string>();
  const registeredModelsUrl = joinEndpoint(normalizedBaseUrl, definition.endpoints.models);
  if (registeredModelsUrl) models.add(registeredModelsUrl);
  if (definition.id === 'custom' && !hasVersionSuffix(normalizedBaseUrl)) {
    const versioned = joinEndpoint(normalizedBaseUrl, '/v1/models');
    if (versioned) models.add(versioned);
  }
  return {
    rawBaseUrl: raw,
    normalizedBaseUrl,
    resolvedModelsUrls: [...models],
    resolvedChatUrl: definition.protocol === 'openai-compatible'
      ? joinEndpoint(normalizedBaseUrl, definition.endpoints.chatCompletions)
      : null,
    resolvedResponsesUrl: joinEndpoint(normalizedBaseUrl, definition.endpoints.responses)
  };
}
