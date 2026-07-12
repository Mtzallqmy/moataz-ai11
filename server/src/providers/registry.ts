import type { ProviderDefinition, ProviderProtocol } from './types.js';

const sharedCustomHeaders = [
  'anthropic-version',
  'anthropic-beta',
  'x-organization',
  'x-project-id',
  'x-provider-routing',
  'http-referer',
  'x-title'
] as const;

const openAiCaps = {
  modelDiscovery: true,
  chat: true,
  streaming: true,
  tools: null,
  vision: null,
  embeddings: null,
  responsesApi: false
} as const;

const definitions: readonly ProviderDefinition[] = [
  {
    id: 'openai', displayName: 'OpenAI', protocol: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: 'responses', allowBaseUrlOverride: false, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: ['x-organization', 'x-project-id'],
    modelExamples: ['gpt-4.1-mini', 'gpt-4o-mini'], capabilities: { ...openAiCaps, tools: true, vision: true, embeddings: true, responsesApi: true }
  },
  {
    id: 'openrouter', displayName: 'OpenRouter', protocol: 'openai-compatible', defaultBaseUrl: 'https://openrouter.ai/api/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders,
    modelExamples: ['openai/gpt-4.1-mini', 'google/gemini-2.0-flash-001'], capabilities: openAiCaps
  },
  {
    id: 'nararouter', displayName: 'NaraRouter', protocol: 'openai-compatible', defaultBaseUrl: 'https://router.bynara.id/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: [], capabilities: openAiCaps
  },
  {
    id: 'omniroute', displayName: 'OmniRoute Gateway', protocol: 'openai-compatible', defaultBaseUrl: null, authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: true,
    apiKeyRequired: true, defaultHeaders: {},
    allowedCustomHeaders: [...sharedCustomHeaders, 'x-omniroute-mode', 'x-omniroute-budget', 'x-omniroute-compression', 'x-route-model'],
    modelExamples: ['auto', 'auto/coding', 'auto/fast', 'auto/cheap', 'auto/offline', 'auto/smart'], capabilities: openAiCaps
  },
  {
    id: 'anthropic', displayName: 'Anthropic', protocol: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', authentication: 'x-api-key',
    modelsPath: null, chatPath: 'v1/messages', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: { 'anthropic-version': '2023-06-01' }, allowedCustomHeaders: ['anthropic-beta'],
    modelExamples: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'], capabilities: { modelDiscovery: false, chat: true, streaming: true, tools: true, vision: true, embeddings: false, responsesApi: false }
  },
  {
    id: 'gemini', displayName: 'Google Gemini', protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com', authentication: 'google-api-key',
    modelsPath: 'v1beta/models', chatPath: null, responsesPath: null, allowBaseUrlOverride: false, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: [], modelExamples: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    capabilities: { modelDiscovery: true, chat: true, streaming: true, tools: true, vision: true, embeddings: true, responsesApi: false }
  },
  {
    id: 'groq', displayName: 'Groq', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.groq.com/openai/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['llama-3.3-70b-versatile'], capabilities: openAiCaps
  },
  {
    id: 'together', displayName: 'Together AI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.together.xyz/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'], capabilities: openAiCaps
  },
  {
    id: 'deepseek', displayName: 'DeepSeek', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.deepseek.com', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['deepseek-chat', 'deepseek-reasoner'], capabilities: openAiCaps
  },
  {
    id: 'mistral', displayName: 'Mistral AI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.mistral.ai/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['mistral-small-latest', 'mistral-large-latest'], capabilities: openAiCaps
  },
  {
    id: 'xai', displayName: 'xAI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.x.ai/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['grok-3-mini', 'grok-3'], capabilities: openAiCaps
  },
  {
    id: 'nvidia', displayName: 'NVIDIA NIM', protocol: 'openai-compatible', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['meta/llama-3.1-70b-instruct'], capabilities: openAiCaps
  },
  {
    id: 'huggingface', displayName: 'Hugging Face Router', protocol: 'openai-compatible', defaultBaseUrl: 'https://router.huggingface.co/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['openai/gpt-oss-120b:cerebras'], capabilities: openAiCaps
  },
  {
    id: 'cerebras', displayName: 'Cerebras', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.cerebras.ai/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['llama-3.3-70b'], capabilities: openAiCaps
  },
  {
    id: 'sambanova', displayName: 'SambaNova', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.sambanova.ai/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['Meta-Llama-3.3-70B-Instruct'], capabilities: openAiCaps
  },
  {
    id: 'fireworks', displayName: 'Fireworks AI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['accounts/fireworks/models/llama-v3p3-70b-instruct'], capabilities: openAiCaps
  },
  {
    id: 'deepinfra', displayName: 'DeepInfra', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.deepinfra.com/v1/openai', authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'], capabilities: openAiCaps
  },
  {
    id: 'perplexity', displayName: 'Perplexity', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.perplexity.ai', authentication: 'bearer',
    modelsPath: null, chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: ['sonar', 'sonar-pro'], capabilities: { ...openAiCaps, modelDiscovery: false }
  },
  {
    id: 'ollama', displayName: 'Ollama (local/development)', protocol: 'openai-compatible', defaultBaseUrl: 'http://127.0.0.1:11434/v1', authentication: 'none',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: true,
    apiKeyRequired: false, defaultHeaders: {}, allowedCustomHeaders: [], modelExamples: ['llama3.2', 'qwen2.5-coder'], capabilities: openAiCaps
  },
  {
    id: 'lmstudio', displayName: 'LM Studio (local/development)', protocol: 'openai-compatible', defaultBaseUrl: 'http://127.0.0.1:1234/v1', authentication: 'none',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: true,
    apiKeyRequired: false, defaultHeaders: {}, allowedCustomHeaders: [], modelExamples: [], capabilities: openAiCaps
  },
  {
    id: 'vllm', displayName: 'vLLM (local/development)', protocol: 'openai-compatible', defaultBaseUrl: 'http://127.0.0.1:8000/v1', authentication: 'none',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: true,
    apiKeyRequired: false, defaultHeaders: {}, allowedCustomHeaders: [], modelExamples: [], capabilities: openAiCaps
  },
  {
    id: 'custom', displayName: 'Custom provider', protocol: 'openai-compatible', defaultBaseUrl: null, authentication: 'bearer',
    modelsPath: 'models', chatPath: 'chat/completions', responsesPath: null, allowBaseUrlOverride: true, allowLocalNetwork: false,
    apiKeyRequired: true, defaultHeaders: {}, allowedCustomHeaders: sharedCustomHeaders, modelExamples: [], capabilities: openAiCaps
  }
];

const byId = new Map(definitions.map((definition) => [definition.id, definition] as const));

export const providerRegistry = definitions;

function protocolTemplate(protocol: ProviderProtocol): Pick<ProviderDefinition, 'protocol' | 'authentication' | 'modelsPath' | 'chatPath' | 'responsesPath' | 'capabilities'> {
  if (protocol === 'anthropic') {
    return {
      protocol, authentication: 'x-api-key', modelsPath: null, chatPath: 'v1/messages', responsesPath: null,
      capabilities: { modelDiscovery: false, chat: true, streaming: true, tools: true, vision: true, embeddings: false, responsesApi: false }
    };
  }
  if (protocol === 'gemini') {
    return {
      protocol, authentication: 'google-api-key', modelsPath: 'v1beta/models', chatPath: null, responsesPath: null,
      capabilities: { modelDiscovery: true, chat: true, streaming: true, tools: true, vision: true, embeddings: true, responsesApi: false }
    };
  }
  return { protocol, authentication: 'bearer', modelsPath: 'models', chatPath: 'chat/completions', responsesPath: protocol === 'openai' ? 'responses' : null, capabilities: openAiCaps };
}

export function getProviderDefinition(providerType: string, protocolOverride?: ProviderProtocol): ProviderDefinition {
  const id = providerType.trim().toLowerCase();
  const found = byId.get(id);
  const base = found ?? { ...byId.get('custom')!, id, displayName: id || 'Custom provider' };
  if (!protocolOverride || protocolOverride === base.protocol) return base;
  return { ...base, ...protocolTemplate(protocolOverride), protocol: protocolOverride };
}
