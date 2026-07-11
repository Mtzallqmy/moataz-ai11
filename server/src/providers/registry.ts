import { AppError } from '../errors.js';
import type { ProviderDefinition } from './types.js';

const openAiCompatible = (
  id: string,
  displayName: string,
  defaultBaseUrl: string,
  modelExamples: readonly string[],
  capabilities: Partial<ProviderDefinition['capabilities']> = {}
): ProviderDefinition => ({
  id,
  displayName,
  protocol: 'openai-compatible',
  defaultBaseUrl,
  authentication: id === 'ollama' ? 'none' : 'bearer',
  endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
  capabilities: {
    modelDiscovery: true,
    streaming: true,
    tools: true,
    vision: null,
    embeddings: null,
    responsesApi: false,
    ...capabilities
  },
  defaultHeaders: {},
  allowedCustomHeaders: ['x-api-key', 'api-key', 'x-goog-api-key'],
  allowsCustomBaseUrl: true,
  localConnection: id === 'ollama' ? 'development-only' : 'never',
  apiKeyRequired: id !== 'ollama',
  modelExamples
});

const definitions: readonly ProviderDefinition[] = [
  {
    ...openAiCompatible('openai', 'OpenAI', 'https://api.openai.com/v1', ['gpt-4.1-mini', 'gpt-4o-mini'], {
      vision: true,
      embeddings: true,
      responsesApi: true
    }),
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: 'responses' },
    allowsCustomBaseUrl: false
  },
  {
    ...openAiCompatible('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', ['openai/gpt-4.1-mini', 'google/gemini-2.0-flash-001']),
    defaultHeaders: { 'X-Title': 'Moataz AI' }
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    authentication: 'x-api-key',
    endpoints: { models: null, chatCompletions: null, responses: null },
    capabilities: { modelDiscovery: false, streaming: true, tools: true, vision: true, embeddings: false, responsesApi: false },
    defaultHeaders: {},
    allowedCustomHeaders: [],
    allowsCustomBaseUrl: true,
    localConnection: 'never',
    apiKeyRequired: true,
    modelExamples: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest']
  },
  {
    id: 'gemini',
    displayName: 'Google Gemini',
    protocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    authentication: 'query-key',
    endpoints: { models: 'v1beta/models', chatCompletions: null, responses: null },
    capabilities: { modelDiscovery: true, streaming: true, tools: null, vision: true, embeddings: true, responsesApi: false },
    defaultHeaders: {},
    allowedCustomHeaders: [],
    allowsCustomBaseUrl: false,
    localConnection: 'never',
    apiKeyRequired: true,
    modelExamples: ['gemini-2.0-flash', 'gemini-1.5-pro']
  },
  openAiCompatible('groq', 'Groq', 'https://api.groq.com/openai/v1', ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']),
  openAiCompatible('together', 'Together AI', 'https://api.together.xyz/v1', ['meta-llama/Llama-3.3-70B-Instruct-Turbo']),
  openAiCompatible('deepseek', 'DeepSeek', 'https://api.deepseek.com', ['deepseek-chat', 'deepseek-reasoner']),
  openAiCompatible('mistral', 'Mistral AI', 'https://api.mistral.ai/v1', ['mistral-small-latest', 'mistral-large-latest']),
  openAiCompatible('nvidia', 'NVIDIA NIM', 'https://integrate.api.nvidia.com/v1', ['meta/llama-3.1-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct']),
  openAiCompatible('huggingface', 'Hugging Face Router', 'https://router.huggingface.co/v1', ['openai/gpt-oss-120b:cerebras', 'Qwen/Qwen3-Coder-480B-A35B-Instruct']),
  openAiCompatible('cerebras', 'Cerebras', 'https://api.cerebras.ai/v1', ['llama-3.3-70b']),
  openAiCompatible('sambanova', 'SambaNova', 'https://api.sambanova.ai/v1', ['Meta-Llama-3.3-70B-Instruct']),
  openAiCompatible('fireworks', 'Fireworks AI', 'https://api.fireworks.ai/inference/v1', ['accounts/fireworks/models/llama-v3p3-70b-instruct']),
  openAiCompatible('deepinfra', 'DeepInfra', 'https://api.deepinfra.com/v1/openai', ['meta-llama/Llama-3.3-70B-Instruct-Turbo']),
  openAiCompatible('perplexity', 'Perplexity', 'https://api.perplexity.ai', ['sonar', 'sonar-pro'], { tools: null }),
  openAiCompatible('xai', 'xAI', 'https://api.x.ai/v1', ['grok-3-mini', 'grok-3']),
  openAiCompatible('ollama', 'Ollama', 'http://127.0.0.1:11434/v1', ['llama3.2', 'qwen2.5-coder'], { vision: null, embeddings: true }),
  {
    ...openAiCompatible('custom', 'Custom OpenAI-compatible', '', []),
    defaultBaseUrl: null,
    capabilities: { modelDiscovery: null, streaming: null, tools: null, vision: null, embeddings: null, responsesApi: null }
  }
];

const registry = new Map(definitions.map((definition) => [definition.id, definition] as const));

export const providerRegistry: readonly ProviderDefinition[] = definitions;

export function getProviderDefinition(providerType: string): ProviderDefinition {
  const id = providerType.trim().toLowerCase();
  const definition = registry.get(id);
  if (definition) return definition;
  throw new AppError('provider_type_unsupported', 422, `Unsupported provider type: ${id}`, {
    providerType: id,
    retryable: false
  });
}

export function isKnownProvider(providerType: string): boolean {
  return registry.has(providerType.trim().toLowerCase());
}
