import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeOutboundUrl } from '../network.js';
import { normalizeProviderBaseUrl, resolveProviderUrls } from './base-url.js';
import { diagnoseProviderError } from './diagnostics.js';
import { ProviderHttpError } from './http.js';
import { parseModelResponse } from './model-response.js';
import { testProviderConnection } from './service.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function mockProvider(handler: (path: string, body: string) => { status: number; body: unknown; contentType?: string }): Promise<string> {
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const result = handler(req.url ?? '/', body);
      res.statusCode = result.status;
      res.setHeader('content-type', result.contentType ?? 'application/json');
      res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/v1`;
}

describe('provider base URL normalization', () => {
  it.each([
    ['https://api.example.com', 'https://api.example.com'],
    [' https://api.example.com/ ', 'https://api.example.com'],
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    ['https://api.example.com/v1/', 'https://api.example.com/v1'],
    ['https://api.example.com/v1/models', 'https://api.example.com/v1'],
    ['https://api.example.com/models', 'https://api.example.com'],
    ['https://api.example.com/v1/chat/completions', 'https://api.example.com/v1'],
    ['https://api.example.com/chat/completions', 'https://api.example.com'],
    ['https://api.example.com/v1/responses?token=secret#x', 'https://api.example.com/v1'],
    ['https://api.example.com/openai/v1', 'https://api.example.com/openai/v1'],
    ['https://api.example.com/api/openai/v1/chat/completions', 'https://api.example.com/api/openai/v1']
  ])('normalizes %s', (input, expected) => {
    expect(normalizeProviderBaseUrl(input)).toBe(expected);
  });

  it('never duplicates version or endpoint paths', () => {
    const resolved = resolveProviderUrls('custom', 'https://api.example.com/openai/v1/chat/completions');
    expect(resolved.normalizedBaseUrl).toBe('https://api.example.com/openai/v1');
    expect(resolved.resolvedChatUrl).toBe('https://api.example.com/openai/v1/chat/completions');
    expect(resolved.resolvedModelsUrls).toEqual(['https://api.example.com/openai/v1/models']);
    expect(resolved.resolvedChatUrl).not.toContain('/v1/v1');
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/plain,x', 'ftp://example.com'])('rejects unsafe protocol %s', (value) => {
    expect(() => normalizeProviderBaseUrl(value)).toThrow();
  });
});

describe('model response validation', () => {
  it('accepts OpenAI data envelope and removes duplicates without changing IDs', () => {
    expect(parseModelResponse({ data: [{ id: 'provider/model:free', owned_by: 'vendor' }, { id: 'provider/model:free' }] }, false))
      .toEqual([{ id: 'provider/model:free', ownedBy: 'vendor' }]);
  });

  it('accepts models with id or name', () => {
    expect(parseModelResponse({ models: [{ id: 'a' }, { name: 'b', context_length: 8192 }] }, false))
      .toEqual([{ id: 'a' }, { id: 'b', contextLength: 8192 }]);
  });

  it('accepts a direct array only for a custom provider', () => {
    expect(parseModelResponse(['x', { id: 'y' }], true)).toEqual([{ id: 'x' }, { id: 'y' }]);
    expect(() => parseModelResponse(['x'], false)).toThrow();
  });

  it('rejects malformed schemas', () => {
    expect(() => parseModelResponse({ data: [{ id: 123 }] }, false)).toThrow();
    expect(() => parseModelResponse({ models: 'not-an-array' }, false)).toThrow();
  });
});

describe('provider inference probe', () => {
  it('does not treat a 404 models endpoint as invalid credentials when inference succeeds', async () => {
    const baseUrl = await mockProvider((path, body) => {
      if (path === '/v1/models') return { status: 404, body: { error: { message: 'Not found' } } };
      if (path === '/v1/chat/completions') {
        const request = JSON.parse(body) as { model: string };
        return { status: 200, body: { model: request.model, choices: [{ message: { content: 'OK' } }] } };
      }
      return { status: 404, body: {} };
    });
    const result = await testProviderConnection({
      config: {
        providerType: 'ollama',
        displayName: 'Local mock',
        apiKey: '',
        model: 'exact-model-id',
        rawBaseUrl: baseUrl
      }
    });
    expect(result.diagnostic.status).toBe('ready');
    expect(result.diagnostic.keyValid).toBe(true);
    expect(result.discovery.status).toBe('unsupported');
    expect(result.model).toBe('exact-model-id');
  });

  it('discovers models and then performs a separate inference request', async () => {
    const paths: string[] = [];
    const baseUrl = await mockProvider((path) => {
      paths.push(path);
      if (path === '/v1/models') return { status: 200, body: { data: [{ id: 'model-a' }, { id: 'model-b' }] } };
      if (path === '/v1/chat/completions') return { status: 200, body: { model: 'model-b', choices: [{ message: { content: 'OK' } }] } };
      return { status: 404, body: {} };
    });
    const result = await testProviderConnection({
      config: { providerType: 'ollama', displayName: 'Local mock', apiKey: '', model: 'model-b', rawBaseUrl: baseUrl }
    });
    expect(result.discovery.models.map((model) => model.id)).toEqual(['model-a', 'model-b']);
    expect(paths).toContain('/v1/models');
    expect(paths).toContain('/v1/chat/completions');
  });
});

describe('provider diagnostics', () => {
  it.each([
    [401, 'invalid_api_key'],
    [403, 'forbidden'],
    [500, 'model_unavailable'],
    [502, 'model_unavailable'],
    [503, 'model_unavailable'],
    [504, 'timeout']
  ] as const)('classifies HTTP %s as %s without guessing credentials', (httpStatus, expected) => {
    const diagnostic = diagnoseProviderError(new ProviderHttpError(`HTTP ${httpStatus}`, { status: httpStatus }), { model: 'm' });
    expect(diagnostic.status).toBe(expected);
    if (httpStatus >= 500) expect(diagnostic.keyValid).not.toBe(false);
  });

  it('classifies model not found separately from endpoint not found', () => {
    expect(diagnoseProviderError(new ProviderHttpError('model abc not found', { status: 404 }), { model: 'abc' }).status).toBe('model_not_found');
    expect(diagnoseProviderError(new ProviderHttpError('route not found', { status: 404 })).status).toBe('endpoint_not_found');
  });

  it('classifies no available channel as retryable model unavailability', () => {
    const diagnostic = diagnoseProviderError(
      new ProviderHttpError('No available channel for model gpt-4.1-mini under group default', { status: 503 }),
      { model: 'gpt-4.1-mini' }
    );
    expect(diagnostic).toMatchObject({
      status: 'model_unavailable',
      providerReachable: true,
      modelAvailable: false,
      retryable: true
    });
    expect(diagnostic.userMessageAr).toContain('لا توجد قناة متاحة');
  });

  it('separates rate limits, quota, and billing', () => {
    expect(diagnoseProviderError(new ProviderHttpError('rate limit exceeded', { status: 429 })).status).toBe('rate_limited');
    expect(diagnoseProviderError(new ProviderHttpError('insufficient_quota', { status: 429 })).status).toBe('insufficient_quota');
    expect(diagnoseProviderError(new ProviderHttpError('insufficient credits; billing required', { status: 429 })).status).toBe('billing_required');
  });

  it('classifies timeout, DNS, TLS, HTML, and malformed JSON', () => {
    expect(diagnoseProviderError(new ProviderHttpError('provider_timeout', { causeCode: 'ABORT_ERR' })).status).toBe('timeout');
    expect(diagnoseProviderError(new ProviderHttpError('getaddrinfo ENOTFOUND', { causeCode: 'ENOTFOUND' })).status).toBe('dns_error');
    expect(diagnoseProviderError(new ProviderHttpError('certificate verify failed', { causeCode: 'CERT_HAS_EXPIRED' })).status).toBe('tls_error');
    expect(diagnoseProviderError(new ProviderHttpError('The provider returned malformed JSON.', { causeCode: 'malformed_json' })).status).toBe('invalid_response');
    expect(diagnoseProviderError(new ProviderHttpError('<html>gateway</html>', { causeCode: 'html_response' })).status).toBe('invalid_response');
  });

  it('redacts recognizable API keys from diagnostic messages', () => {
    const diagnostic = diagnoseProviderError(new ProviderHttpError('Authorization failed for sk-test-abcdefghijklmnopqrstuvwxyz123456'));
    expect(diagnostic.message).not.toContain('sk-test-abcdefghijklmnopqrstuvwxyz123456');
  });
});

describe('SSRF policy', () => {
  it.each([
    'http://localhost:8080/v1',
    'http://127.0.0.1:8080/v1',
    'http://0.0.0.0:8080/v1',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]:8080/v1'
  ])('blocks private or metadata target %s by default', async (url) => {
    await expect(assertSafeOutboundUrl(url, false)).rejects.toThrow();
  });

  it('allows an explicitly local Ollama endpoint only through the local-provider policy', async () => {
    const baseUrl = await mockProvider(() => ({ status: 200, body: { data: [] } }));
    await expect(assertSafeOutboundUrl(baseUrl, true)).resolves.toBeDefined();
  });
});
