import { decrypt, encrypt } from '../crypto.js';
import { cryptoId } from '../database/ids.js';
import { AppError } from '../errors.js';
import {
  discoverModels,
  getProviderDefinition,
  resolveProviderUrls,
  testProviderConnection,
  type DiscoveredModel,
  type ProviderDiagnosticResult,
  type ProviderRuntimeConfig
} from '../providers/index.js';
import { providersRepository, type ProviderRecord } from '../repositories/providers.repository.js';

export type ProviderDraftInput = {
  name: string;
  type: string;
  apiKey: string;
  baseUrl?: string;
  selectedModel?: string | null;
};

export function providerRuntimeConfig(row: ProviderRecord, model?: string): ProviderRuntimeConfig {
  return {
    providerType: row.type,
    displayName: row.name,
    apiKey: decrypt(row.api_key_enc),
    model: (model ?? row.selected_model ?? row.default_model).trim(),
    ...(row.raw_base_url ? { rawBaseUrl: row.raw_base_url } : row.normalized_base_url ? { normalizedBaseUrl: row.normalized_base_url } : {})
  };
}

export function publicProvider(row: ProviderRecord) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    protocol: row.protocol,
    raw_base_url: row.raw_base_url,
    normalized_base_url: row.normalized_base_url,
    base_url: row.normalized_base_url,
    selected_model: row.selected_model,
    default_model: row.default_model,
    discovered_models: row.discovered_models,
    capabilities: row.capabilities,
    status: row.status,
    last_check_status: row.last_check_status,
    last_check_code: row.last_check_code,
    last_check_message: row.last_check_message,
    last_checked_at: row.last_checked_at,
    last_latency_ms: row.last_latency_ms,
    failure_count: row.failure_count,
    next_retry_at: row.next_retry_at,
    is_enabled: row.is_enabled,
    is_ready: row.is_ready,
    validation_status: row.validation_status,
    validation_error_code: row.validation_error_code,
    validated_at: row.validated_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizedDraft(input: ProviderDraftInput) {
  const definition = getProviderDefinition(input.type);
  if (definition.apiKeyRequired && !input.apiKey.trim()) throw new AppError('provider_api_key_required', 422);
  const urls = resolveProviderUrls(definition.id, input.baseUrl);
  const selectedModel = input.selectedModel?.trim() || null;
  return {
    definition,
    rawBaseUrl: input.baseUrl?.trim() || definition.defaultBaseUrl,
    normalizedBaseUrl: urls.normalizedBaseUrl,
    selectedModel
  };
}

function diagnosticFromError(error: unknown): ProviderDiagnosticResult | undefined {
  if (!(error instanceof AppError) || error.details === null || typeof error.details !== 'object' || Array.isArray(error.details)) return undefined;
  const details = error.details as Record<string, unknown>;
  if (typeof details.status !== 'string' || typeof details.success !== 'boolean') return undefined;
  return details as unknown as ProviderDiagnosticResult;
}

export const providersService = {
  async list(userId: string) {
    return (await providersRepository.listForUser(userId)).map(publicProvider);
  },

  async createDraft(userId: string, input: ProviderDraftInput): Promise<ProviderRecord> {
    const normalized = normalizedDraft(input);
    return providersRepository.createDraft({
      id: cryptoId(),
      userId,
      name: input.name,
      providerType: normalized.definition.id,
      protocol: normalized.definition.protocol,
      rawBaseUrl: normalized.rawBaseUrl ?? null,
      normalizedBaseUrl: normalized.normalizedBaseUrl,
      encryptedApiKey: encrypt(input.apiKey.trim()),
      selectedModel: normalized.selectedModel,
      capabilities: normalized.definition.capabilities
    });
  },

  async updateDraft(userId: string, id: string, input: Partial<ProviderDraftInput>): Promise<ProviderRecord> {
    const existing = await providersRepository.findOwned(userId, id);
    if (!existing) throw new AppError('provider_not_found', 404);
    const apiKey = input.apiKey?.trim() || decrypt(existing.api_key_enc);
    const draft: ProviderDraftInput = {
      name: input.name ?? existing.name,
      type: input.type ?? existing.type,
      apiKey,
      baseUrl: input.baseUrl === undefined ? existing.raw_base_url ?? undefined : input.baseUrl,
      selectedModel: input.selectedModel === undefined ? existing.selected_model : input.selectedModel
    };
    const normalized = normalizedDraft(draft);
    const updated = await providersRepository.updateDraft(userId, id, {
      name: draft.name,
      providerType: normalized.definition.id,
      protocol: normalized.definition.protocol,
      rawBaseUrl: normalized.rawBaseUrl ?? null,
      normalizedBaseUrl: normalized.normalizedBaseUrl,
      encryptedApiKey: encrypt(apiKey),
      selectedModel: normalized.selectedModel,
      capabilities: normalized.definition.capabilities
    });
    if (!updated) throw new AppError('provider_not_found', 404);
    return updated;
  },

  async discoverDraft(input: ProviderDraftInput, force = false) {
    const normalized = normalizedDraft(input);
    return discoverModels({
      providerType: normalized.definition.id,
      displayName: input.name || normalized.definition.displayName,
      apiKey: input.apiKey,
      model: input.selectedModel?.trim() || 'manual-model-required',
      rawBaseUrl: normalized.rawBaseUrl
    }, { force });
  },

  async discoverSaved(userId: string, id: string, force = false) {
    const row = await providersRepository.findOwned(userId, id);
    if (!row) throw new AppError('provider_not_found', 404);
    const result = await discoverModels(providerRuntimeConfig(row), { force });
    if (result.status === 'supported') {
      await providersRepository.replaceDiscoveredModels(
        userId,
        id,
        result.models,
        new Date(Date.now() + 300_000).toISOString()
      );
    }
    return result;
  },

  async retest(userId: string, id: string, requestId?: string): Promise<{ provider: ProviderRecord; diagnostic: ProviderDiagnosticResult; responsePreview: string }> {
    const row = await providersRepository.findOwned(userId, id);
    if (!row) throw new AppError('provider_not_found', 404);
    await providersRepository.markTesting(userId, id);
    try {
      const tested = await testProviderConnection({ config: providerRuntimeConfig(row), requestId });
      const definition = getProviderDefinition(row.type);
      const updated = await providersRepository.applyDiagnostic(userId, id, tested.diagnostic, {
        selectedModel: tested.model,
        discoveredModels: tested.discovery.models,
        capabilities: definition.capabilities
      });
      if (!updated) throw new AppError('provider_not_found', 404);
      if (tested.discovery.status === 'supported') {
        await providersRepository.replaceDiscoveredModels(
          userId,
          id,
          tested.discovery.models,
          new Date(Date.now() + 300_000).toISOString()
        );
      }
      return { provider: updated, diagnostic: tested.diagnostic, responsePreview: tested.responsePreview };
    } catch (error) {
      const diagnostic = diagnosticFromError(error);
      if (diagnostic) await providersRepository.applyDiagnostic(userId, id, diagnostic);
      throw error;
    }
  },

  async testDraft(input: ProviderDraftInput, requestId?: string) {
    const normalized = normalizedDraft(input);
    return testProviderConnection({
      config: {
        providerType: normalized.definition.id,
        displayName: input.name || normalized.definition.displayName,
        apiKey: input.apiKey,
        model: normalized.selectedModel ?? 'manual-model-required',
        rawBaseUrl: normalized.rawBaseUrl
      },
      requestId
    });
  },

  async readyForChat(userId: string, id?: string): Promise<ProviderRecord> {
    if (id) {
      const exact = await providersRepository.findOwned(userId, id);
      if (!exact) throw new AppError('provider_not_found', 404);
      if (!exact.is_ready || exact.status !== 'ready' || !exact.is_enabled) {
        throw new AppError('provider_not_ready', 409, 'The selected provider must pass a real inference test before use.', {
          providerId: id,
          status: exact.status,
          lastCheckCode: exact.last_check_code
        });
      }
      return exact;
    }
    const ready = await providersRepository.listReadyForUser(userId);
    if (ready.length === 0) throw new AppError('provider_not_ready', 409, 'Configure and test an AI provider before sending messages.');
    if (ready.length > 1) throw new AppError('provider_required', 409, 'Select a provider for this conversation.');
    return ready[0]!;
  },

  async disable(userId: string, id: string): Promise<void> {
    if (!await providersRepository.disable(userId, id)) throw new AppError('provider_not_found', 404);
  },

  async findOwned(userId: string, id: string): Promise<ProviderRecord> {
    const row = await providersRepository.findOwned(userId, id);
    if (!row) throw new AppError('provider_not_found', 404);
    return row;
  }
};

export function modelIds(models: DiscoveredModel[]): string[] {
  return models.map((model) => model.id);
}
