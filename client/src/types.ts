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

export type SystemStatus = {
  version: string;
  database: 'ready' | 'unavailable';
  shell: { enabled: boolean; sandboxMode: string; externalConfigured?: boolean };
  telegram: { enabled: boolean; botCount: number; configuredCount: number; discoveryOnlyCount: number };
  terminal: { enabled: boolean; activeConnections: number };
  uptimeSeconds: number;
  providerCount: number;
};
