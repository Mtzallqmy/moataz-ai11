export type ProviderStatus = 'draft' | 'testing' | 'ready' | 'temporarily_unavailable' | 'invalid_credentials' | 'disabled' | 'configuration_error';
export type ValidationStatus = ProviderStatus | 'untested' | 'verified' | 'failed' | string;
export type CapabilityValue = boolean | null;

export type ProviderCapabilities = {
  modelDiscovery: CapabilityValue;
  streaming: CapabilityValue;
  tools: CapabilityValue;
  vision: CapabilityValue;
  embeddings: CapabilityValue;
};

export type ProviderCatalogEntry = {
  id: string;
  label: string;
  displayName?: string;
  protocol: 'openai-chat' | 'anthropic-messages' | 'gemini-generate-content';
  adapter: 'openai-compatible' | 'anthropic' | 'gemini';
  defaultBaseUrl: string | null;
  authStyle?: string;
  endpoints?: { models: string | null; chatCompletions: string | null; responses: string | null };
  capabilities: ProviderCapabilities;
  baseUrlRequired: boolean;
  apiKeyRequired: boolean;
  allowBaseUrlOverride?: boolean;
  allowLocalNetwork?: boolean;
  modelExamples: readonly string[];
};

export type DiscoveredModel = {
  id: string;
  name?: string;
  ownedBy?: string;
  contextLength?: number;
  capabilities?: {
    chat?: boolean | null;
    tools?: boolean | null;
    vision?: boolean | null;
    streaming?: boolean | null;
    embeddings?: boolean | null;
  };
};

export type ModelDiscoveryResult = {
  success: boolean;
  status: 'models_discovered' | 'model_discovery_unsupported' | 'model_discovery_failed';
  supported: boolean;
  models: DiscoveredModel[];
  testedEndpoint?: string;
  httpStatus?: number;
  latencyMs?: number;
  requestId?: string;
  upstreamRequestId?: string;
  message: string;
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

export type ProviderDiagnostic = {
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

export type ProviderSummary = {
  id: string;
  name: string;
  type: string;
  protocol?: string | null;
  default_model: string;
  selected_model?: string;
  base_url?: string | null;
  raw_base_url?: string | null;
  normalized_base_url?: string | null;
  discovered_models?: DiscoveredModel[];
  capabilities?: Partial<ProviderCapabilities>;
  validation_status: ValidationStatus;
  status?: ProviderStatus;
  validation_error_code?: string | null;
  last_check_message?: string | null;
  validated_at?: string | null;
  last_latency_ms?: number | null;
  failure_count?: number;
  next_retry_at?: string | null;
  is_ready?: boolean;
  is_enabled?: boolean;
};

export type IntegrationType = 'github' | 'telegram' | 'brave_search' | 'tavily' | 'sandbox';
export type DiscoveredTelegramChat = { id: string; type?: string; title?: string; username?: string; lastSeenAt?: string };
export type IntegrationSummary = {
  id: string;
  name: string;
  type: IntegrationType;
  meta?: {
    allowedChatIds?: unknown[];
    allowAllChats?: boolean;
    discoveredChats?: DiscoveredTelegramChat[];
    baseUrl?: string;
    identity?: Record<string, unknown>;
    chatPreferences?: Record<string, { providerId?: string; mode?: 'chat' | 'agent' }>;
    [key: string]: unknown;
  };
  validation_status: ValidationStatus;
  validation_error_code?: string | null;
  validated_at?: string | null;
};

export type ChatSummary = {
  id: string;
  title: string;
  provider_id?: string | null;
  provider_name?: string | null;
  provider_type?: string | null;
  provider_available?: number | boolean;
  model?: string | null;
  mode?: 'chat' | 'agent';
};

export type CapabilityStatus = { chat: boolean; agent: boolean; files: boolean; webFetch: boolean; webSearch: boolean; github: boolean; telegram: boolean; sandbox: boolean; terminal: boolean };
export type SystemStatus = {
  version: string;
  database: 'ready' | 'unavailable';
  shell: { enabled: boolean; sandboxMode: string; externalConfigured?: boolean };
  telegram: { enabled: boolean; botCount: number; configuredCount: number; discoveryOnlyCount: number };
  terminal: { enabled: boolean; activeConnections: number };
  uptimeSeconds: number;
  providerCount: number;
  verifiedProviderCount?: number;
  integrationCount?: number;
  verifiedIntegrationCount?: number;
  toolCount?: number;
  capabilities?: CapabilityStatus;
};
