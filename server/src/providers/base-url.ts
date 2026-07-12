import { AppError } from '../errors.js';
import type { NormalizedProviderUrls, ProviderDefinition } from './types.js';

const knownTerminalPaths = [
  '/chat/completions',
  '/completions',
  '/responses',
  '/models'
] as const;

function stripKnownTerminalPath(pathname: string): string {
  let current = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  for (const suffix of knownTerminalPaths) {
    if (current.toLowerCase().endsWith(suffix)) {
      current = current.slice(0, -suffix.length).replace(/\/+$/, '') || '/';
      break;
    }
  }
  return current;
}

function withDefaultProtocol(raw: string): string {
  const trimmed = raw.trim();
  const looksLikeHostPort = /^(?:localhost|\[[^\]]+\]|(?:[a-z0-9-]+\.)*[a-z0-9-]+):\d+(?:[/?#]|$)/i.test(trimmed);
  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !looksLikeHostPort;
  if (hasExplicitScheme) return trimmed;
  return `https://${trimmed.replace(/^\/\//, '')}`;
}

function parseAbsoluteHttpUrl(raw: string): URL {
  const candidate = withDefaultProtocol(raw);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new AppError('provider_base_url_invalid', 422, 'The provider Base URL must be a valid HTTP or HTTPS URL.', {
      stage: 'invalid_request', retryable: false
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('provider_unsupported_protocol', 422, 'Only HTTP and HTTPS provider URLs are supported.', {
      stage: 'invalid_request', retryable: false
    });
  }
  if (url.username || url.password) {
    throw new AppError('provider_base_url_invalid', 422, 'Credentials must not be embedded in a provider URL.', {
      stage: 'invalid_request', retryable: false
    });
  }
  url.search = '';
  url.hash = '';
  url.pathname = stripKnownTerminalPath(url.pathname);
  return url;
}

function joinEndpoint(baseUrl: string | null, endpoint: string | null): string | null {
  if (!baseUrl || !endpoint) return null;
  const normalizedEndpoint = endpoint.replace(/^\/+/, '');
  return new URL(normalizedEndpoint, `${baseUrl.replace(/\/+$/, '')}/`).toString().replace(/\/+$/, '');
}

export function normalizeProviderUrls(
  definition: ProviderDefinition,
  suppliedBaseUrl: string | null | undefined
): NormalizedProviderUrls {
  const supplied = suppliedBaseUrl?.trim() || null;
  let rawBaseUrl = supplied || definition.defaultBaseUrl;

  if (supplied && definition.defaultBaseUrl) {
    const suppliedUrl = parseAbsoluteHttpUrl(supplied);
    const defaultUrl = parseAbsoluteHttpUrl(definition.defaultBaseUrl);
    const suppliedPath = suppliedUrl.pathname.replace(/\/+$/, '') || '/';
    if (suppliedUrl.origin === defaultUrl.origin && suppliedPath === '/') {
      rawBaseUrl = definition.defaultBaseUrl;
    }
  }

  if (!rawBaseUrl) {
    return {
      rawBaseUrl: supplied,
      normalizedBaseUrl: null,
      resolvedModelsUrl: null,
      resolvedChatUrl: null,
      resolvedResponsesUrl: null
    };
  }
  if (supplied && !definition.allowBaseUrlOverride) {
    const suppliedUrl = parseAbsoluteHttpUrl(supplied).toString().replace(/\/+$/, '');
    const expected = definition.defaultBaseUrl ? parseAbsoluteHttpUrl(definition.defaultBaseUrl).toString().replace(/\/+$/, '') : null;
    if (expected && suppliedUrl !== expected) {
      throw new AppError('provider_base_url_override_forbidden', 422, 'This provider does not allow a custom Base URL.', {
        stage: 'invalid_request', retryable: false
      });
    }
  }
  const normalized = parseAbsoluteHttpUrl(rawBaseUrl).toString().replace(/\/+$/, '');
  return {
    rawBaseUrl: supplied,
    normalizedBaseUrl: normalized,
    resolvedModelsUrl: joinEndpoint(normalized, definition.modelsPath),
    resolvedChatUrl: joinEndpoint(normalized, definition.chatPath),
    resolvedResponsesUrl: joinEndpoint(normalized, definition.responsesPath)
  };
}

export function customModelDiscoveryCandidates(normalizedBaseUrl: string): string[] {
  const base = normalizedBaseUrl.replace(/\/+$/, '');
  const parsed = new URL(base);
  const path = parsed.pathname.replace(/\/+$/, '');
  const candidates = [new URL('models', `${base}/`).toString().replace(/\/+$/, '')];
  const hasVersionSegment = /\/(?:v\d+(?:beta\d*)?|openai\/v\d+)$/i.test(path);
  if (!hasVersionSegment) {
    candidates.push(new URL('v1/models', `${base}/`).toString().replace(/\/+$/, ''));
  }
  return [...new Set(candidates)];
}

export function normalizeBaseUrlOnly(value: string): string {
  const synthetic: ProviderDefinition = {
    id: 'custom', displayName: 'Custom', protocol: 'openai-compatible', defaultBaseUrl: null,
    authentication: 'bearer', modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null,
    allowBaseUrlOverride: true, allowLocalNetwork: false, apiKeyRequired: true,
    defaultHeaders: {}, allowedCustomHeaders: [], modelExamples: [],
    capabilities: { modelDiscovery: null, chat: true, streaming: null, tools: null, vision: null, embeddings: null, responsesApi: null }
  };
  const result = normalizeProviderUrls(synthetic, value);
  if (!result.normalizedBaseUrl) throw new AppError('provider_base_url_invalid', 422);
  return result.normalizedBaseUrl;
}
