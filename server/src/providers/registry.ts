import { AppError } from '../errors.js';
import type { ProviderCapabilities, ProviderDefinition } from './types.js';

const unknownModelCapabilities: ProviderCapabilities = {
  modelDiscovery: true,
  streaming: true,
  tools: null,
  vision: null,
  embeddings: null,
  responsesApi: null
};

function compatible(input: Omit<ProviderDefinition, 'protocol' | 'authentication' | 'endpoints' | 'capabilities' | 'defaultHeaders' | 'allowedCustomHeaders' | 'localConnection' | 'apiKeyRequired'> & {
  capabilities?: Partial<ProviderCapabilities> | undefined;
  responsesPath?: string | null | undefined;
  apiKeyRequired?: boolean | undefined;
  localConnection?: 'never' | 'development-only' | undefined;
  defaultHeaders?: Readonly<Record<string, string>> | undefined;
}): ProviderDefinition {
  return {
    ...input,
    protocol: 'openai-compatible',
    authentication: input.apiKeyRequired === false ? 'none' : 'bearer',
    endpoints: {
      models: '/models',
      chatCompletions: '/chat/completions',
      responses: input.responsesPath ?? null
    },
    capabilities: { ...unknownModelCapabilities, ...(input.capabilities ?? {}) },
    defaultHeaders: input.defaultHeaders ?? {},
    allowedCustomHeaders: ['x-api-key', 'api-key', 'x-organization', 'x-project-id'],
    localConnection: input.localConnection ?? 'never',
    apiKeyRequired: input.apiKeyRequired ?? true
  };
}

export const providerRegistry: readonly ProviderDefinition[] = [
  compatible({
    id: 'openai',
    displayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    allowsCustomBaseUrl: true,
    modelExamples: ['gpt-4.1-mini'],
    responsesPath: '/responses',
    capabilities: { tools: true, vision: true, embeddings: true, responsesApi: true }
  }),
  compatible({
    id: 'openrouter',
    displayName: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    allowsCustomBaseUrl: true,
    modelExamples: ['openai/gpt-4.1-mini'],
    capabilities: { tools: null, vision: null, embeddings: null, responsesApi: false }
  }),
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    authentication: 'x-api-key',
    endpoints: { models: null, chatCompletions: '/v1/messages', responses: null },
    capabilities: {
      modelDiscovery: false,
      streaming: true,
      tools: true,
      vision: true,
      embeddings: false,
      responsesApi: false
    },
    defaultHeaders: { 'anthropic-version': '2023-06-01' },
    allowedCustomHeaders: [],
    allowsCustomBaseUrl: false,
    localConnection: 'never',
    apiKeyRequired: true,
    modelExamples: ['claude-sonnet-4-20250514']
  },
  {
    id: 'gemini',
    displayName: 'Google Gemini',
    protocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authentication: 'query-key',
    endpoints: { models: '/models', chatCompletions: '/models/{model}:generateContent', responses: null },
    capabilities: {
      modelDiscovery: true,
      streaming: true,
      tools: true,
      vision: true,
      embeddings: true,
      responsesApi: false
    },
    defaultHeaders: {},
    allowedCustomHeaders: [],
    allowsCustomBaseUrl: false,
    localConnection: 'never',
    apiKeyRequired: true,
    modelExamples: ['gemini-2.5-flash']
  },
  compatible({
    id: 'groq', displayName: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1',
    allowsCustomBaseUrl: true, modelExamples: ['llama-3.3-70b-versatile'], capabilities: { tools: true }
  }),
  compatible({
    id: 'together', displayName: 'Together AI', defaultBaseUrl: 'https://api.together.xyz/v1',
    allowsCustomBaseUrl: true, modelExamples: ['meta-llama/Llama-3.3-70B-Instruct-Turbo']
  }),
  compatible({
    id: 'deepseek', displayName: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1',
    allowsCustomBaseUrl: true, modelExamples: ['deepseek-chat'], capabilities: { tools: true }
  }),
  compatible({
    id: 'mistral', displayName: 'Mistral AI', defaultBaseUrl: 'https://api.mistral.ai/v1',
    allowsCustomBaseUrl: true, modelExamples: ['mistral-small-latest'], capabilities: { tools: true }
  }),
  compatible({
    id: 'nvidia', displayName: 'NVIDIA NIM', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    allowsCustomBaseUrl: true, modelExamples: ['meta/llama-3.1-70b-instruct']
  }),
  compatible({
    id: 'huggingface', displayName: 'Hugging Face Router', defaultBaseUrl: 'https://router.huggingface.co/v1',
    allowsCustomBaseUrl: true, modelExamples: ['openai/gpt-oss-120b:cerebras']
  }),
  compatible({
    id: 'cerebras', displayName: 'Cerebras', defaultBaseUrl: 'https://api.cerebras.ai/v1',
    allowsCustomBaseUrl: true, modelExamples: ['llama-3.3-70b']
  }),
  compatible({
    id: 'sambanova', displayName: 'SambaNova', defaultBaseUrl: 'https://api.sambanova.ai/v1',
    allowsCustomBaseUrl: true, modelExamples: ['Meta-Llama-3.3-70B-Instruct']
  }),
  compatible({
    id: 'fireworks', displayName: 'Fireworks AI', defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    allowsCustomBaseUrl: true, modelExamples: ['accounts/fireworks/models/llama-v3p1-70b-instruct']
  }),
  compatible({
    id: 'deepinfra', displayName: 'DeepInfra', defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
    allowsCustomBaseUrl: true, modelExamples: ['meta-llama/Llama-3.3-70B-Instruct']
  }),
  compatible({
    id: 'perplexity', displayName: 'Perplexity', defaultBaseUrl: 'https://api.perplexity.ai',
    allowsCustomBaseUrl: true, modelExamples: ['sonar'], capabilities: { modelDiscovery: null }
  }),
  compatible({
    id: 'xai', displayName: 'xAI', defaultBaseUrl: 'https://api.x.ai/v1',
    allowsCustomBaseUrl: true, modelExamples: ['grok-3-mini'], capabilities: { tools: null, vision: null }
  }),
  compatible({
    id: 'ollama',
    displayName: 'Ollama',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    allowsCustomBaseUrl: true,
    modelExamples: ['llama3.2'],
    apiKeyRequired: false,
    localConnection: 'development-only',
    capabilities: { embeddings: true }
  }),
  compatible({
    id: 'custom',
    displayName: 'Custom OpenAI-compatible',
    defaultBaseUrl: null,
    allowsCustomBaseUrl: true,
    modelExamples: [],
    capabilities: {
      modelDiscovery: null,
      streaming: null,
      tools: null,
      vision: null,
      embeddings: null,
      responsesApi: null
    }
  })
] as const;

const definitions = new Map(providerRegistry.map((definition) => [definition.id, definition]));

export function getProviderDefinition(id: string): ProviderDefinition {
  const normalized = id.trim().toLowerCase();
  const definition = definitions.get(normalized);
  if (!definition) throw new AppError('provider_type_unsupported', 422, `Unsupported provider type: ${normalized || 'empty'}.`);
  return definition;
}

export function providerDefinitionExists(id: string): boolean {
  return definitions.has(id.trim().toLowerCase());
}
