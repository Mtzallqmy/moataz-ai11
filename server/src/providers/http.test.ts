import { afterEach, describe, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({
  assertSafeOutboundUrl: vi.fn(async (url: string) => new URL(url)),
  readLimitedText: vi.fn(async (response: Response) => response.text())
}));

vi.mock('../network.js', () => network);

import { providerHttpJson } from './http.js';
import { getProviderDefinition } from './registry.js';
import type { NormalizedProviderConfig } from './types.js';

function config(): NormalizedProviderConfig {
  const definition = getProviderDefinition('nararouter');
  return {
    providerType: definition.id, protocol: definition.protocol, definition,
    apiKey: 'never-log-this-key', selectedModel: null, customHeaders: {}, credentialVersion: 1,
    rawBaseUrl: definition.defaultBaseUrl, normalizedBaseUrl: definition.defaultBaseUrl,
    resolvedModelsUrl: `${definition.defaultBaseUrl}/models`,
    resolvedChatUrl: `${definition.defaultBaseUrl}/chat/completions`, resolvedResponsesUrl: null
  };
}

describe('provider HTTP transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends Bearer authorization server-side and parses JSON', async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer never-log-this-key');
      return new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), {
        status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await providerHttpJson({
      method: 'GET', url: 'https://router.bynara.id/v1/models', config: config(),
      timeoutMs: 1000, maxResponseBytes: 1024
    });
    expect(result.payload).toEqual({ data: [{ id: 'model-a' }] });
    expect(result.requestId).toBe('req-1');
  });

  it('returns an invalid-response diagnostic for malformed JSON without exposing the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken', {
      status: 200, headers: { 'content-type': 'application/json' }
    })));
    await expect(providerHttpJson({
      method: 'GET', url: 'https://router.bynara.id/v1/models', config: config(),
      timeoutMs: 1000, maxResponseBytes: 1024
    })).rejects.toSatisfy((error: unknown) => {
      const text = JSON.stringify(error);
      return text.includes('provider_invalid_response') && !text.includes('never-log-this-key');
    });
  });
});
