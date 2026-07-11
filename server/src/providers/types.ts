import type { Msg, LLMToolSpec } from '../llm-types.js';

export type ProviderProtocol = 'openai-compatible' | 'anthropic' | 'gemini';
export type ProviderAuthStyle = 'bearer' | 'x-api-key' | 'query-key' | 'none';
export type CapabilityValue = boolean | null;

export type ProviderCapabilities = {
  modelDiscovery: CapabilityValue;
  streaming: CapabilityValue;
  tools: CapabilityValue;
  vision: CapabilityValue;
  embeddings: CapabilityValue;
  responsesApi: CapabilityValue;
};

export type ProviderDefinition = {
  id: string;
  displayName: string;
  protocol: ProviderProtocol;
  defaultBaseUrl: string | null;
  authentication: ProviderAuthStyle;
  endpoints: {
    models: string | null;
    chatCompletions: string | null;
    responses: string | null;
  };
  capabilities: ProviderCapabilities;
  defaultHeaders: Readonly<Record<string, string>>;
  allowedCustomHeaders: readonly string[];
  allowsCustomBaseUrl: boolean;
  localConnection: 'never' | 'development-only';
  apiKeyRequired: boolean;
  modelExamples: readonly string[];
};

export type NormalizedBaseUrl = {
  rawBaseUrl: string;
  normalizedBaseUrl: string;
  resolvedModelsUrls: readonly string[];
  resolvedChatUrl: string | null;
  resolvedResponsesUrl: string | null;
};

export type ProviderRuntimeConfig = {
  providerType: string;
  displayName: string;
  apiKey: string;
  model: string;
  rawBaseUrl?: string | undefined;
  normalizedBaseUrl?: string | undefined;
  customHeaders?: Readonly<Record<string, string>> | undefined;
};

export type DiscoveredModelCapabilities = {
  chat?: CapabilityValue | undefined;
  tools?: CapabilityValue | undefined;
  vision?: CapabilityValue | undefined;
  streaming?: CapabilityValue | undefined;
  embeddings?: CapabilityValue | undefined;
};

export type DiscoveredModel = {
  id: string;
  name?: string | undefined;
  ownedBy?: string | undefined;
  contextLength?: number | undefined;
  capabilities?: DiscoveredModelCapabilities | undefined;
};

export type ModelDiscoveryStatus = 'supported' | 'unsupported' | 'failed';

export type ModelDiscoveryResult = {
  status: ModelDiscoveryStatus;
  models: DiscoveredModel[];
  testedEndpoints: string[];
  latencyMs: number;
  cached: boolean;
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

export type ProviderToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ProviderChatResult = {
  text: string;
  toolCalls: ProviderToolCall[];
  model: string;
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    totalTokens?: number | undefined;
  } | undefined;
  upstreamRequestId?: string | undefined;
};

export type ProviderStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; call: ProviderToolCall }
  | { type: 'usage'; inputTokens?: number | undefined; outputTokens?: number | undefined; totalTokens?: number | undefined }
  | { type: 'done'; model: string; upstreamRequestId?: string | undefined };

export type ProviderChatInput = {
  config: ProviderRuntimeConfig;
  messages: readonly Msg[];
  tools?: readonly LLMToolSpec[] | undefined;
  signal?: AbortSignal | undefined;
  maxOutputTokens?: number | undefined;
  temperature?: number | undefined;
};

export interface ProviderAdapter {
  readonly protocol: ProviderProtocol;
  normalizeConfig(input: ProviderRuntimeConfig): ProviderRuntimeConfig;
  discoverModels(config: ProviderRuntimeConfig, signal?: AbortSignal | undefined): Promise<ModelDiscoveryResult>;
  createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult>;
  streamChatCompletion?(input: ProviderChatInput): AsyncIterable<ProviderStreamEvent>;
}
