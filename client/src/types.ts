export type ValidationStatus = 'untested' | 'verified' | 'failed' | string;

export type ProviderProtocol = 'openai' | 'openai-compatible' | 'anthropic' | 'gemini';

export type ProviderCatalogEntry = {
  id: string;
  label: string;
  adapter: ProviderProtocol;
  defaultBaseUrl: string | null;
  baseUrlRequired: boolean;
  apiKeyRequired: boolean;
  modelExamples: readonly string[];
  allowBaseUrlOverride?: boolean;
  capabilities?: Record<string, boolean | null>;
};

export type DiscoveredProviderModel = {
  id: string;
  name?: string;
  ownedBy?: string;
  contextLength?: number;
  capabilities?: Record<string, boolean | null>;
};

export type ProviderModelDiscovery = {
  status: 'supported' | 'unsupported' | 'failed';
  models: DiscoveredProviderModel[];
  testedEndpoint?: string;
  httpStatus?: number;
  requestId?: string;
  latencyMs?: number;
  fromCache: boolean;
  message?: string;
  method?: 'sdk' | 'fetch' | 'manual';
};

export type ProviderDiagnostic = {
  success: boolean;
  ok: boolean;
  stage: 'configuration' | 'authentication' | 'model_discovery' | 'inference' | 'streaming';
  status: string;
  errorType?: string;
  keyValid: boolean | null;
  providerReachable: boolean | null;
  modelAvailable: boolean | null;
  retryable: boolean;
  httpStatus?: number;
  providerCode?: string;
  message: string;
  userMessage: string;
  userMessageAr: string;
  userMessageEn: string;
  technicalMessage?: string;
  requestId?: string;
  upstreamRequestId?: string;
  retryAfterSeconds?: number;
  testedEndpoint?: string;
  testedModel?: string;
  latencyMs?: number;
  discovery?: ProviderModelDiscovery;
};

export type ProviderSummary = {
  id: string;
  name: string;
  type: string;
  protocol: ProviderProtocol;
  default_model: string;
  base_url?: string | null;
  streaming_enabled?: boolean;
  key_mask?: string | null;
  has_custom_headers?: boolean;
  credential_version?: number;
  validation_status: ValidationStatus;
  validation_error_code?: string | null;
  last_error_message?: string | null;
  validated_at?: string | null;
};

export type IntegrationType = 'github' | 'telegram' | 'brave_search' | 'tavily' | 'sandbox';

export type DiscoveredTelegramChat = {
  id: string;
  type?: string;
  title?: string;
  username?: string;
  lastSeenAt?: string;
};

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

export type AttachmentSummary = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  kind: 'image' | 'archive' | 'text' | 'file';
  created_at: string;
};

export type ChatMode = 'chat' | 'agent' | 'multi-agent';

export type ChatSummary = {
  id: string;
  title: string;
  provider_id?: string | null;
  provider_name?: string | null;
  provider_type?: string | null;
  provider_available?: number | boolean;
  model?: string | null;
  mode?: ChatMode;
};

export type CapabilityStatus = {
  chat: boolean;
  agent: boolean;
  files: boolean;
  webFetch: boolean;
  webSearch: boolean;
  github: boolean;
  telegram: boolean;
  sandbox: boolean;
  terminal: boolean;
};

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

export type AuthSession = {
  id: string;
  created_at: string;
  expires_at: string;
  user_agent?: string | null;
  current: boolean;
};
