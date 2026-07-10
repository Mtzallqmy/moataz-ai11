export type ValidationStatus = 'untested' | 'verified' | 'failed' | string;

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

export type IntegrationSummary = {
  id: string;
  name: string;
  type: 'github' | 'telegram';
  meta?: Record<string, unknown>;
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
  shell: { enabled: boolean; sandboxMode: string };
  telegram: { enabled: boolean; botCount: number };
  terminal: { enabled: boolean; activeConnections: number };
  uptimeSeconds: number;
  providerCount: number;
};
