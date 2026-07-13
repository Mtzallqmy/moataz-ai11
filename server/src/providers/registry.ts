import type { ProviderDefinition } from './types.js';

const openAiCompatibleCapabilities = {
  modelDiscovery: true,
  streaming: null,
  tools: null,
  vision: null,
  embeddings: null
} as const;

const definitions: readonly ProviderDefinition[] = [
  {
    id: 'openai', displayName: 'OpenAI', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.openai.com/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: 'responses' },
    capabilities: { modelDiscovery: true, streaming: true, tools: true, vision: true, embeddings: true },
    defaultHeaders: {}, allowedCustomHeaders: ['OpenAI-Organization', 'OpenAI-Project'],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['gpt-4.1-mini', 'gpt-4o-mini']
  },
  {
    id: 'openrouter', displayName: 'OpenRouter', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://openrouter.ai/api/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: { ...openAiCompatibleCapabilities, tools: true, streaming: true },
    defaultHeaders: {}, allowedCustomHeaders: ['HTTP-Referer', 'X-Title'],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['openai/gpt-4.1-mini', 'google/gemini-2.0-flash-001']
  },
  {
    id: 'anthropic', displayName: 'Anthropic', protocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com', authenticationStyle: 'x-api-key',
    endpoints: { models: null, chatCompletions: 'v1/messages', responses: null },
    capabilities: { modelDiscovery: null, streaming: true, tools: true, vision: true, embeddings: false },
    defaultHeaders: { 'anthropic-version': '2023-06-01' }, allowedCustomHeaders: ['anthropic-beta'],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest']
  },
  {
    id: 'gemini', displayName: 'Google Gemini', protocol: 'gemini-generate-content',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', authenticationStyle: 'query-key',
    endpoints: { models: 'models', chatCompletions: null, responses: null },
    capabilities: { modelDiscovery: true, streaming: true, tools: null, vision: true, embeddings: true },
    defaultHeaders: {}, allowedCustomHeaders: [], allowCustomBaseUrl: true,
    allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['gemini-2.0-flash', 'gemini-1.5-pro']
  },
  {
    id: 'groq', displayName: 'Groq', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.groq.com/openai/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']
  },
  {
    id: 'together', displayName: 'Together AI', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.together.xyz/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['meta-llama/Llama-3.3-70B-Instruct-Turbo']
  },
  {
    id: 'deepseek', displayName: 'DeepSeek', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.deepseek.com', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    id: 'mistral', displayName: 'Mistral AI', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.mistral.ai/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['mistral-small-latest', 'mistral-large-latest']
  },
  {
    id: 'nvidia', displayName: 'NVIDIA NIM', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['meta/llama-3.1-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct']
  },
  {
    id: 'huggingface', displayName: 'Hugging Face Router', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://router.huggingface.co/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['openai/gpt-oss-120b:cerebras', 'Qwen/Qwen3-Coder-480B-A35B-Instruct']
  },
  {
    id: 'cerebras', displayName: 'Cerebras', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.cerebras.ai/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['llama-3.3-70b']
  },
  {
    id: 'sambanova', displayName: 'SambaNova', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.sambanova.ai/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['Meta-Llama-3.3-70B-Instruct']
  },
  {
    id: 'fireworks', displayName: 'Fireworks AI', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['accounts/fireworks/models/llama-v3p3-70b-instruct']
  },
  {
    id: 'deepinfra', displayName: 'DeepInfra', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['meta-llama/Llama-3.3-70B-Instruct-Turbo']
  },
  {
    id: 'perplexity', displayName: 'Perplexity', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.perplexity.ai', authenticationStyle: 'bearer',
    endpoints: { models: null, chatCompletions: 'chat/completions', responses: null },
    capabilities: { ...openAiCompatibleCapabilities, modelDiscovery: null }, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['sonar', 'sonar-pro']
  },
  {
    id: 'xai', displayName: 'xAI', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.x.ai/v1', authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: openAiCompatibleCapabilities, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: false, apiKeyRequired: true,
    modelExamples: ['grok-3-mini', 'grok-3']
  },
  {
    id: 'ollama', displayName: 'Ollama', protocol: 'openai-chat-completions',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1', authenticationStyle: 'none',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: { ...openAiCompatibleCapabilities, streaming: true, tools: null }, defaultHeaders: {}, allowedCustomHeaders: [],
    allowCustomBaseUrl: true, allowLocalConnection: true, apiKeyRequired: false,
    modelExamples: ['llama3.2', 'qwen2.5-coder']
  },
  {
    id: 'custom', displayName: 'Custom OpenAI-compatible', protocol: 'openai-chat-completions',
    defaultBaseUrl: null, authenticationStyle: 'bearer',
    endpoints: { models: 'models', chatCompletions: 'chat/completions', responses: null },
    capabilities: { modelDiscovery: null, streaming: null, tools: null, vision: null, embeddings: null },
    defaultHeaders: {}, allowedCustomHeaders: [], allowCustomBaseUrl: true,
    allowLocalConnection: false, apiKeyRequired: true, modelExamples: []
  }
];

const registry = new Map(definitions.map((definition) => [definition.id, definition] as const));

export const providerRegistry: readonly ProviderDefinition[] = definitions;

export function getProviderDefinition(type: string): ProviderDefinition {
  const normalized = type.trim().toLowerCase();
  return registry.get(normalized) ?? {
    ...registry.get('custom')!,
    id: normalized,
    displayName: normalized || 'Custom OpenAI-compatible'
  };
}

export function isKnownProvider(type: string): boolean {
  return registry.has(type.trim().toLowerCase());
}
