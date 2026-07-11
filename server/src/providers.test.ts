import { describe, expect, it } from 'vitest';
import { assertProviderCredentials, providerDefinition, resolveProviderBaseUrl } from './providers.js';

describe('provider catalog', () => {
  it('provides production presets for common OpenAI-compatible services', () => {
    expect(resolveProviderBaseUrl('nvidia', undefined)).toBe('https://integrate.api.nvidia.com/v1');
    expect(resolveProviderBaseUrl('huggingface', undefined)).toBe('https://router.huggingface.co/v1');
    expect(resolveProviderBaseUrl('groq', undefined)).toBe('https://api.groq.com/openai/v1');
  });

  it('allows a custom OpenAI-compatible provider with an explicit URL', () => {
    const definition = providerDefinition('my_gateway');
    expect(definition.adapter).toBe('openai-compatible');
    expect(definition.baseUrlRequired).toBe(true);
    expect(resolveProviderBaseUrl('my_gateway', 'https://llm.example.com/v1/')).toBe('https://llm.example.com/v1');
  });

  it('requires credentials according to provider capabilities', () => {
    expect(() => assertProviderCredentials('openrouter', '', 'https://openrouter.ai/api/v1')).toThrow(/API key/i);
    expect(() => assertProviderCredentials('custom', 'key', undefined)).toThrow(/base URL/i);
    expect(() => assertProviderCredentials('ollama', '', 'http://127.0.0.1:11434/v1')).not.toThrow();
  });
});
