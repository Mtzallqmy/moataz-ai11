import type { LLMImage, LLMToolCall, LLMToolSpec, Msg } from '../llm-types.js';

export type ProviderProtocol = 'openai-compatible' | 'anthropic' | 'gemini';
export type ProviderAuthStyle = 'bearer' | 'x-api-key' | 'google-api-key' | 'none';
export type ProviderCapability = boolean | null;

export type ProviderCapabilities = {
  modelDiscovery: ProviderCapability;
  chat: ProviderCapability;
  streaming: ProviderCapability;
  tools: ProviderCapability;
  vision: ProviderCapability;
  embeddings: ProviderCapability;
  responsesApi: ProviderCapability;
};

export type ProviderDefinition = {
  id: string;
  displayName: string;
  protocol: ProviderProtocol;
  defaultBaseUrl: string | null;
  authentication: ProviderAuthStyle;
  modelsPath: string | null;
  chatPath: string | null;
  responsesPath: string | null;
  allowBaseUrlOverride: boolean;
  allowLocalNetwork: boolean;
  apiKeyRequired: boolean;
  defaultHeaders: Readonly<Record<string, string>>;
  allowedCustomHeaders: readonly string[];
  modelExamples: readonly string[];
  capabilities: ProviderCapabilities;
};

export type NormalizedProviderUrls = {
  rawBaseUrl: string | null;
  normalizedBaseUrl: string | null;
  resolvedModelsUrl: string | null;
  resolvedChatUrl: string | null;
  resolvedResponsesUrl: string | null;
};

export type NormalizedProviderConfig = NormalizedProviderUrls & {
  providerType: string;
  definition: ProviderDefinition;
  apiKey: string;
  selectedModel: string | null;
  customHeaders: Readonly<Record<string, string>>;
};

export type DiscoveredModel = {
  id: string;
  name?: string | undefined;
  ownedBy?: string | undefined;
  contextLength?: number | undefined;
  capabilities?: {
    chat?: ProviderCapability | undefined;
    tools?: ProviderCapability | undefined;
    vision?: ProviderCapability | undefined;
    streaming?: ProviderCapability | undefined;
    embeddings?: ProviderCapability | undefined;
  } | undefined;
};

export type ModelDiscoveryStatus = 'supported' | 'unsupported' | 'failed';
export type ModelDiscoveryResult = {
  status: ModelDiscoveryStatus;
  models: DiscoveredModel[];
  testedEndpoint?: string | undefined;
  httpStatus?: number | undefined;
  requestId?: string | undefined;
  latencyMs?: number | undefined;
  fromCache: boolean;
  message?: string | undefined;
};

export type ProviderDiagnosticStatus =
  | 'ready'
  | 'invalid_api_key'
  | 'forbidden'
  | 'invalid_base_url'
  | 'endpoint_not_found'
  | 'model_not_found'
  | 'model_unavailable'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'insufficient_quota'
  | 'billing_required'
  | 'timeout'
  | 'network_error'
  | 'dns_error'
  | 'tls_error'
  | 'unsupported_protocol'
  | 'model_discovery_unsupported'
  | 'invalid_request'
  | 'invalid_response'
  | 'unknown_error';

export type ProviderDiagnosticResult = {
  success: boolean;
  status: ProviderDiagnosticStatus;
  keyValid: boolean | null;
  providerReachable: boolean | null;
  modelAvailable: boolean | null;
  retryable: boolean;
  httpStatus?: number | undefined;
  providerCode?: string | undefined;
  message: string;
  userMessageAr: string;
  userMessageEn: string;
  requestId?: string | undefined;
  upstreamRequestId?: string | undefined;
  testedEndpoint?: string | undefined;
  testedModel?: string | undefined;
  latencyMs?: number | undefined;
  discovery?: ModelDiscoveryResult | undefined;
};

export type ProviderChatInput = {
  config: NormalizedProviderConfig;
  messages: readonly Msg[];
  model: string;
  tools?: readonly LLMToolSpec[] | undefined;
  signal?: AbortSignal | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
};

export type ProviderChatResult = {
  text: string;
  toolCalls: LLMToolCall[];
  model: string;
  requestId?: string | undefined;
  usage?: { inputTokens?: number | undefined; outputTokens?: number | undefined; totalTokens?: number | undefined } | undefined;
};

export type ProviderStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; call: LLMToolCall }
  | { type: 'completed'; result: ProviderChatResult }
  | { type: 'error'; diagnostic: ProviderDiagnosticResult };

export interface ProviderAdapter {
  readonly definition: ProviderDefinition;
  normalizeConfig(input: {
    apiKey?: string | undefined;
    baseUrl?: string | null | undefined;
    selectedModel?: string | null | undefined;
    customHeaders?: Record<string, string> | undefined;
  }): NormalizedProviderConfig;
  discoverModels(config: NormalizedProviderConfig, options?: { force?: boolean | undefined; signal?: AbortSignal | undefined }): Promise<ModelDiscoveryResult>;
  testConnection(config: NormalizedProviderConfig, selectedModel?: string | undefined): Promise<ProviderDiagnosticResult>;
  createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult>;
  streamChatCompletion?(input: ProviderChatInput): AsyncIterable<ProviderStreamEvent>;
}

export type ProviderImage = LLMImage;
