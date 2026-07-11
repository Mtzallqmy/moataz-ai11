import { AppError } from './errors.js';

export type ProviderAdapter = 'openai-compatible' | 'anthropic' | 'gemini';

export type ProviderCatalogEntry = {
  id: string;
  label: string;
  adapter: ProviderAdapter;
  defaultBaseUrl: string | null;
  baseUrlRequired: boolean;
  apiKeyRequired: boolean;
  modelExamples: readonly string[];
};

const entries: readonly ProviderCatalogEntry[] = [
  { id: 'openai', label: 'OpenAI', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['gpt-4.1-mini', 'gpt-4o-mini'] },
  { id: 'openrouter', label: 'OpenRouter', adapter: 'openai-compatible', defaultBaseUrl: 'https://openrouter.ai/api/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['openai/gpt-4.1-mini', 'google/gemini-2.0-flash-001'] },
  { id: 'anthropic', label: 'Anthropic', adapter: 'anthropic', defaultBaseUrl: null, baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'] },
  { id: 'gemini', label: 'Google Gemini', adapter: 'gemini', defaultBaseUrl: null, baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['gemini-2.0-flash', 'gemini-1.5-pro'] },
  { id: 'nvidia', label: 'NVIDIA NIM', adapter: 'openai-compatible', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['meta/llama-3.1-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct'] },
  { id: 'huggingface', label: 'Hugging Face Router', adapter: 'openai-compatible', defaultBaseUrl: 'https://router.huggingface.co/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['openai/gpt-oss-120b:cerebras', 'Qwen/Qwen3-Coder-480B-A35B-Instruct'] },
  { id: 'groq', label: 'Groq', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.groq.com/openai/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'] },
  { id: 'together', label: 'Together AI', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.together.xyz/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
  { id: 'deepseek', label: 'DeepSeek', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.deepseek.com', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'mistral', label: 'Mistral AI', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.mistral.ai/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['mistral-small-latest', 'mistral-large-latest'] },
  { id: 'xai', label: 'xAI', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.x.ai/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['grok-3-mini', 'grok-3'] },
  { id: 'cerebras', label: 'Cerebras', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.cerebras.ai/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['llama-3.3-70b'] },
  { id: 'sambanova', label: 'SambaNova', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.sambanova.ai/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['Meta-Llama-3.3-70B-Instruct'] },
  { id: 'fireworks', label: 'Fireworks AI', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['accounts/fireworks/models/llama-v3p3-70b-instruct'] },
  { id: 'deepinfra', label: 'DeepInfra', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.deepinfra.com/v1/openai', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
  { id: 'perplexity', label: 'Perplexity', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.perplexity.ai', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['sonar', 'sonar-pro'] },
  { id: 'ollama', label: 'Ollama (local/development)', adapter: 'openai-compatible', defaultBaseUrl: 'http://127.0.0.1:11434/v1', baseUrlRequired: true, apiKeyRequired: false, modelExamples: ['llama3.2', 'qwen2.5-coder'] },
  { id: 'custom', label: 'Custom OpenAI-compatible', adapter: 'openai-compatible', defaultBaseUrl: null, baseUrlRequired: true, apiKeyRequired: true, modelExamples: [] }
];

const catalog = new Map(entries.map((entry) => [entry.id, entry] as const));

export const providerCatalog: readonly ProviderCatalogEntry[] = entries;

export function providerDefinition(type: string): ProviderCatalogEntry {
  const normalized = type.trim().toLowerCase();
  return catalog.get(normalized) ?? {
    id: normalized,
    label: normalized,
    adapter: 'openai-compatible',
    defaultBaseUrl: null,
    baseUrlRequired: true,
    apiKeyRequired: true,
    modelExamples: []
  };
}

export function providerAdapter(type: string): ProviderAdapter {
  return providerDefinition(type).adapter;
}

function withProtocol(value: string): string {
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function stripResourcePath(url: URL): void {
  const path = url.pathname.replace(/\/+$/, '');
  const resourcePatterns = [
    /\/chat\/completions$/i,
    /\/completions$/i,
    /\/models$/i,
    /\/responses$/i
  ];
  for (const pattern of resourcePatterns) {
    if (pattern.test(path)) {
      url.pathname = path.replace(pattern, '') || '/';
      return;
    }
  }
}

export function normalizeBaseUrl(value: string | undefined | null): string | undefined {
  if (!value?.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(withProtocol(value));
  } catch {
    throw new AppError('provider_base_url_invalid', 422, 'The provider Base URL must be an absolute HTTP or HTTPS URL.', {
      stage: 'invalid_request', retryable: false
    });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError('provider_base_url_invalid', 422, 'Only HTTP and HTTPS provider URLs are supported.', {
      stage: 'invalid_request', retryable: false
    });
  }
  if (url.username || url.password) {
    throw new AppError('provider_base_url_invalid', 422, 'Credentials must not be embedded in the Base URL.', {
      stage: 'invalid_request', retryable: false
    });
  }
  url.hash = '';
  url.search = '';
  stripResourcePath(url);
  return url.toString().replace(/\/+$/, '');
}

export function resolveProviderBaseUrl(type: string, supplied: string | undefined | null): string | undefined {
  const normalizedType = type.trim().toLowerCase();
  if (normalizedType === 'gemini' && supplied && /generativelanguage\.googleapis\.com/i.test(supplied)) {
    return undefined;
  }
  const suppliedUrl = normalizeBaseUrl(supplied);
  if (suppliedUrl) {
    const definition = providerDefinition(normalizedType);
    if (definition.defaultBaseUrl) {
      const candidate = new URL(suppliedUrl);
      const canonical = new URL(definition.defaultBaseUrl);
      if (candidate.hostname === canonical.hostname && (candidate.pathname === '/' || candidate.pathname === '')) {
        candidate.pathname = canonical.pathname;
        return candidate.toString().replace(/\/+$/, '');
      }
    }
    return suppliedUrl;
  }
  return normalizeBaseUrl(providerDefinition(normalizedType).defaultBaseUrl);
}

export function assertProviderCredentials(type: string, apiKey: string, baseUrl: string | undefined): void {
  const definition = providerDefinition(type);
  if (definition.apiKeyRequired && !apiKey.trim()) {
    throw new AppError('provider_api_key_required', 422, 'An API key is required for this provider.');
  }
  if (definition.baseUrlRequired && !baseUrl) {
    throw new AppError('provider_base_url_required', 422, 'A base URL is required for this provider.');
  }
}
