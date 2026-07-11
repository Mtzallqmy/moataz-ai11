export type ProviderProtocol = 'openai-chat-completions' | 'anthropic-messages' | 'gemini-generate-content';
export type ProviderAuthenticationStyle = 'bearer' | 'x-api-key' | 'query-key' | 'none';
export type ProviderCapability = boolean | null;

export type ProviderCapabilities = {
  modelDiscovery: ProviderCapability;
  streaming: ProviderCapability;
  tools: ProviderCapability;
  vision: ProviderCapability;
  embeddings: ProviderCapability;
};

export type ProviderDefinition = {
  id: string;
  displayName: string;
  protocol: ProviderProtocol;
  defaultBaseUrl: string | null;
  authenticationStyle: ProviderAuthenticationStyle;
  endpoints: {
    models: string | null;
    chatCompletions: string | null;
    responses: string | null;
  };
  capabilities: ProviderCapabilities;
  defaultHeaders: Readonly<Record<string, string>>;
  allowedCustomHeaders: readonly string[];
  allowCustomBaseUrl: boolean;
  allowLocalConnection: boolean;
  apiKeyRequired: boolean;
  modelExamples: readonly string[];
};

export type NormalizedProviderUrl = {
  rawBaseUrl: string | null;
  normalizedBaseUrl: string | null;
  resolvedModelsUrls: readonly string[];
  resolvedChatUrl: string | null;
  resolvedResponsesUrl: string | null;
};

export type ProviderConfig = {
  type: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  customHeaders?: Readonly<Record<string, string>>;
};

export type NormalizedProviderConfig = ProviderConfig & NormalizedProviderUrl & {
  definition: ProviderDefinition;
  selectedModel: string;
  headers: Readonly<Record<string, string>>;
  allowPrivateNetwork: boolean;
};

export type ModelCapabilities = {
  chat?: boolean | null;
  tools?: boolean | null;
  vision?: boolean | null;
  streaming?: boolean | null;
  embeddings?: boolean | null;
};

export type DiscoveredModel = {
  id: string;
  name?: string;
  ownedBy?: string;
  contextLength?: number;
  capabilities?: ModelCapabilities;
};

export type ModelDiscoveryStatus = 'supported' | 'unsupported' | 'failed';
export type ModelDiscoveryResult = {
  status: ModelDiscoveryStatus;
  supported: boolean;
  models: DiscoveredModel[];
  testedEndpoints: string[];
  fromCache: boolean;
  expiresAt?: string;
  warning?: string;
};

export type LLMToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type LLMToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type LLMImage = { mimeType: string; dataBase64: string; name?: string };
export type ProviderMessage =
  | { role: 'system' | 'user'; content: string; images?: readonly LLMImage[] }
  | { role: 'assistant'; content: string; toolCalls?: readonly LLMToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export type ChatCompletionInput = {
  config: NormalizedProviderConfig;
  messages: readonly ProviderMessage[];
  model: string;
  tools?: readonly LLMToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type ChatCompletionResult = {
  text: string;
  toolCalls: LLMToolCall[];
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  upstreamRequestId?: string;
};

export type ChatStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; call: LLMToolCall }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'done'; model: string };

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
  attempts?: ProviderProbeAttempt[];
};

export type ProviderProbeAttempt = {
  model: string;
  status: 'working' | 'failed';
  diagnostic?: ProviderDiagnosticResult;
};

export interface ProviderAdapter {
  readonly protocol: ProviderProtocol;
  normalizeConfig(input: ProviderConfig): NormalizedProviderConfig;
  discoverModels(config: NormalizedProviderConfig, signal?: AbortSignal): Promise<ModelDiscoveryResult>;
  testConnection(config: NormalizedProviderConfig, signal?: AbortSignal): Promise<ProviderDiagnosticResult>;
  createChatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResult>;
  streamChatCompletion?(input: ChatCompletionInput): AsyncIterable<ChatStreamEvent>;
}
