import { describe, expect, it } from 'vitest';
import { assertProviderCredentials, normalizeBaseUrl, providerDefinition, resolveProviderBaseUrl } from './providers.js';
import { getProviderDefinition, normalizeProviderConfig } from './providers/index.js';

describe('provider catalog and base URLs', () => {
  it('defines exact production endpoints for OpenAI-compatible routers', () => {
    expect(resolveProviderBaseUrl('nararouter', undefined)).toBe('https://router.bynara.id/v1');
    expect(resolveProviderBaseUrl('openrouter', undefined)).toBe('https://openrouter.ai/api/v1');
    expect(resolveProviderBaseUrl('groq', undefined)).toBe('https://api.groq.com/openai/v1');
    expect(resolveProviderBaseUrl('deepinfra', undefined)).toBe('https://api.deepinfra.com/v1/openai');
  });

  it('builds NaraRouter models and chat endpoints without duplicating /v1', () => {
    const normalized = normalizeProviderConfig({
      providerType: 'nararouter',
      apiKey: 'test-key',
      baseUrl: 'https://router.bynara.id/v1/',
      selectedModel: 'actual/model-id'
    });
    expect(normalized.normalizedBaseUrl).toBe('https://router.bynara.id/v1');
    expect(normalized.resolvedModelsUrl).toBe('https://router.bynara.id/v1/models');
    expect(normalized.resolvedChatUrl).toBe('https://router.bynara.id/v1/chat/completions');
    expect(normalized.resolvedChatUrl).not.toContain('/v1/v1/');
  });

  it('strips terminal endpoint paths and matching outer quotes', () => {
    expect(normalizeBaseUrl(' "https://router.bynara.id/v1/chat/completions" ')).toBe('https://router.bynara.id/v1');
    expect(normalizeBaseUrl("'https://openrouter.ai/api/v1/models/'")).toBe('https://openrouter.ai/api/v1');
    expect(normalizeBaseUrl('https://api.groq.com/openai/v1/responses')).toBe('https://api.groq.com/openai/v1');
  });

  it('does not remove valid nested API path segments', () => {
    expect(normalizeBaseUrl('https://api.deepinfra.com/v1/openai/')).toBe('https://api.deepinfra.com/v1/openai');
    expect(normalizeBaseUrl('https://api.groq.com/openai/v1')).toBe('https://api.groq.com/openai/v1');
  });

  it('rejects unsupported schemes and embedded credentials', () => {
    expect(() => normalizeBaseUrl('file:///tmp/model')).toThrow(/HTTP/i);
    expect(() => normalizeBaseUrl('https://user:pass@example.com/v1')).toThrow(/Credentials/i);
  });

  it('does not infer a provider protocol from API key prefixes', () => {
    expect(providerDefinition('nararouter').adapter).toBe('openai-compatible');
    expect(getProviderDefinition('anthropic').protocol).toBe('anthropic');
    expect(getProviderDefinition('gemini').protocol).toBe('gemini');
  });

  it('requires credentials according to provider capabilities', () => {
    expect(() => assertProviderCredentials('nararouter', '', 'https://router.bynara.id/v1')).toThrow(/API key/i);
    expect(() => assertProviderCredentials('custom', 'key', undefined)).toThrow(/Base URL/i);
    expect(() => assertProviderCredentials('ollama', '', 'http://127.0.0.1:11434/v1')).not.toThrow();
  });
});
