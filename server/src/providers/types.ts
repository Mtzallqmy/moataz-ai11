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
  rawBaseUrl?: string;
  normalizedBaseUrl?: string;
  customHeaders?: Readonly<Record<string, string>>;
};

export type DiscoveredModelCapabilities = {
  chat?: CapabilityValue;
  tools?: CapabilityValue;
  vision?: CapabilityValue;
  streaming?: CapabilityValue;
  embeddings?: CapabilityValue;
};

export type DiscoveredModel = {
  id: string;
  name?: string;
  ownedBy?: string;
  contextLength?: number;
  capabilities?: DiscoveredModelCapabilities;
};

export type ModelDiscoveryStatus = 'supported' | 'unsupported' | 'failed';

export type ModelDiscoveryResult = {
  status: ModelDiscoveryStatus;
  models: DiscoveredModel[];
  testedEndpoints: string[];
  latencyMs: number;
  cached: boolean;
  message?: string;
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
  httpStatus?: number;
  providerCode?: string;
  message: string;
  userMessageAr: string;
  userMessageEn: string;
  requestId?: string;
  upstreamRequestId?: string;
  testedEndpoint?: string;
  testedModel?: string;
  latencyMs?: number;
  discovery?: ModelDiscoveryResult;
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
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  upstreamRequestId?: string;
};

export type ProviderStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; call: ProviderToolCall }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { type: 'done'; model: string; upstreamRequestId?: string };

export type ProviderChatInput = {
  config: ProviderRuntimeConfig;
  messages: readonly Msg[];
  tools?: readonly LLMToolSpec[];
  signal?: AbortSignal;
  maxOutputTokens?: number;
  temperature?: number;
};

export interface ProviderAdapter {
  readonly protocol: ProviderProtocol;
  normalizeConfig(input: ProviderRuntimeConfig): ProviderRuntimeConfig;
  discoverModels(config: ProviderRuntimeConfig, signal?: AbortSignal): Promise<ModelDiscoveryResult>;
  createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult>;
  streamChatCompletion?(input: ProviderChatInput): AsyncIterable<ProviderStreamEvent>;
}
