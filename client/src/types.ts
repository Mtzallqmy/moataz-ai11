export type ValidationStatus = 'untested' | 'verified' | 'failed' | string;

export type ProviderCatalogEntry = {
  id: string;
  label: string;
  adapter: 'openai-compatible' | 'anthropic' | 'gemini';
  defaultBaseUrl: string | null;
  baseUrlRequired: boolean;
  apiKeyRequired: boolean;
  modelExamples: readonly string[];
};

export type ProviderProbeAttempt = {
  model: string;
  status: 'working' | 'failed';
  errorCode?: string;
  errorStage?: string;
};

export type ProviderDiagnostic = {
  providerType: string;
  availability: 'available' | 'limited' | 'unavailable' | 'unknown';
  plan: 'free' | 'paid' | 'mixed' | 'unknown';
  billing: 'request_succeeded' | 'credits_required' | 'rate_limited' | 'not_checked' | 'unknown';
  planDetection: 'provider_declared' | 'inferred_from_error' | 'not_exposed';
  completionSucceeded: boolean;
  modelsEndpoint: 'supported' | 'unsupported' | 'failed' | 'not_checked';
  modelCount: number;
  selectedModel?: string;
  selectedAutomatically?: boolean;
  attempts?: ProviderProbeAttempt[];
  errorStage?: string;
  retryable: boolean;
  evidence: string[];
  note: string;
  checkedAt: string;
};

export type ProviderSummary = {
  id: string;
  name: string;
  type: string;
  default_model: string;
  base_url?: string | null;
  validation_status: ValidationStatus;
  validation_error_code?: string | null;
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
