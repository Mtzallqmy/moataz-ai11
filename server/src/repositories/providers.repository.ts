import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { database } from '../database/client.js';
import { providerModels, providers } from '../database/schema.js';
import type { DiscoveredModel, ProviderCapabilities, ProviderDiagnosticResult, ProviderProtocol } from '../providers/types.js';

export type ProviderStatus =
  | 'draft'
  | 'testing'
  | 'ready'
  | 'temporarily_unavailable'
  | 'invalid_credentials'
  | 'disabled'
  | 'configuration_error';

export type ProviderRecord = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  protocol: ProviderProtocol;
  raw_base_url: string | null;
  normalized_base_url: string | null;
  base_url: string | null;
  api_key_enc: string;
  encryption_version: number;
  selected_model: string | null;
  default_model: string;
  discovered_models: DiscoveredModel[];
  capabilities: ProviderCapabilities;
  status: ProviderStatus;
  last_check_status: string | null;
  last_check_code: string | null;
  last_check_message: string | null;
  last_checked_at: string | null;
  last_latency_ms: number | null;
  failure_count: number;
  next_retry_at: string | null;
  is_enabled: boolean;
  is_ready: boolean;
  validation_status: string;
  validation_error_code: string | null;
  validated_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function record(row: typeof providers.$inferSelect): ProviderRecord {
  const discovered = Array.isArray(row.discoveredModels) ? row.discoveredModels as DiscoveredModel[] : [];
  const capabilities = row.capabilities !== null && typeof row.capabilities === 'object' && !Array.isArray(row.capabilities)
    ? row.capabilities as ProviderCapabilities
    : { modelDiscovery: null, streaming: null, tools: null, vision: null, embeddings: null, responsesApi: null };
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    type: row.providerType,
    protocol: row.protocol as ProviderProtocol,
    raw_base_url: row.rawBaseUrl,
    normalized_base_url: row.normalizedBaseUrl,
    base_url: row.normalizedBaseUrl ?? row.legacyBaseUrl,
    api_key_enc: row.encryptedApiKey,
    encryption_version: row.encryptionVersion,
    selected_model: row.selectedModel,
    default_model: row.selectedModel ?? row.legacyDefaultModel,
    discovered_models: discovered,
    capabilities,
    status: row.status as ProviderStatus,
    last_check_status: row.lastCheckStatus,
    last_check_code: row.lastCheckCode,
    last_check_message: row.lastCheckMessage,
    last_checked_at: row.lastCheckedAt,
    last_latency_ms: row.lastLatencyMs,
    failure_count: row.failureCount,
    next_retry_at: row.nextRetryAt,
    is_enabled: row.isEnabled,
    is_ready: row.isReady,
    validation_status: row.legacyValidationStatus,
    validation_error_code: row.legacyValidationErrorCode,
    validated_at: row.legacyValidatedAt,
    is_active: row.legacyIsActive,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

function legacyStatus(status: ProviderStatus): string {
  if (status === 'ready') return 'verified';
  if (status === 'invalid_credentials' || status === 'configuration_error') return 'failed';
  return 'untested';
}

function statusFromDiagnostic(diagnostic: ProviderDiagnosticResult): ProviderStatus {
  if (diagnostic.success) return 'ready';
  if (diagnostic.status === 'invalid_api_key' || diagnostic.status === 'forbidden') return 'invalid_credentials';
  if (diagnostic.retryable) return 'temporarily_unavailable';
  return 'configuration_error';
}

export const providersRepository = {
  async listForUser(userId: string): Promise<ProviderRecord[]> {
    const rows = await database.select().from(providers)
      .where(and(eq(providers.userId, userId), eq(providers.legacyIsActive, true)))
      .orderBy(desc(providers.createdAt));
    return rows.map(record);
  },

  async listReadyForUser(userId: string): Promise<ProviderRecord[]> {
    const rows = await database.select().from(providers)
      .where(and(
        eq(providers.userId, userId),
        eq(providers.legacyIsActive, true),
        eq(providers.isEnabled, true),
        eq(providers.isReady, true),
        eq(providers.status, 'ready')
      ))
      .orderBy(desc(providers.lastCheckedAt), desc(providers.createdAt));
    return rows.map(record);
  },

  async findOwned(userId: string, id: string): Promise<ProviderRecord | undefined> {
    const [row] = await database.select().from(providers)
      .where(and(eq(providers.id, id), eq(providers.userId, userId), eq(providers.legacyIsActive, true)))
      .limit(1);
    return row ? record(row) : undefined;
  },

  async createDraft(input: {
    id: string;
    userId: string;
    name: string;
    providerType: string;
    protocol: ProviderProtocol;
    rawBaseUrl: string | null;
    normalizedBaseUrl: string | null;
    encryptedApiKey: string;
    selectedModel: string | null;
    capabilities: ProviderCapabilities;
  }): Promise<ProviderRecord> {
    const [row] = await database.insert(providers).values({
      id: input.id,
      userId: input.userId,
      name: input.name,
      providerType: input.providerType,
      protocol: input.protocol,
      rawBaseUrl: input.rawBaseUrl,
      normalizedBaseUrl: input.normalizedBaseUrl,
      legacyBaseUrl: input.normalizedBaseUrl,
      encryptedApiKey: input.encryptedApiKey,
      selectedModel: input.selectedModel,
      legacyDefaultModel: input.selectedModel ?? 'manual-model-required',
      capabilities: input.capabilities,
      status: 'draft',
      isEnabled: true,
      isReady: false,
      legacyValidationStatus: 'untested',
      legacyIsActive: true
    }).returning();
    return record(row!);
  },

  async updateDraft(userId: string, id: string, input: {
    name: string;
    providerType: string;
    protocol: ProviderProtocol;
    rawBaseUrl: string | null;
    normalizedBaseUrl: string | null;
    encryptedApiKey: string;
    selectedModel: string | null;
    capabilities: ProviderCapabilities;
  }): Promise<ProviderRecord | undefined> {
    const [row] = await database.update(providers).set({
      name: input.name,
      providerType: input.providerType,
      protocol: input.protocol,
      rawBaseUrl: input.rawBaseUrl,
      normalizedBaseUrl: input.normalizedBaseUrl,
      legacyBaseUrl: input.normalizedBaseUrl,
      encryptedApiKey: input.encryptedApiKey,
      selectedModel: input.selectedModel,
      legacyDefaultModel: input.selectedModel ?? 'manual-model-required',
      capabilities: input.capabilities,
      status: 'draft',
      isReady: false,
      lastCheckStatus: null,
      lastCheckCode: null,
      lastCheckMessage: null,
      lastCheckedAt: null,
      lastLatencyMs: null,
      nextRetryAt: null,
      legacyValidationStatus: 'untested',
      legacyValidationErrorCode: null,
      legacyValidatedAt: null,
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(and(eq(providers.id, id), eq(providers.userId, userId), eq(providers.legacyIsActive, true))).returning();
    return row ? record(row) : undefined;
  },

  async markTesting(userId: string, id: string): Promise<void> {
    await database.update(providers).set({
      status: 'testing',
      isReady: false,
      lastCheckStatus: 'testing',
      legacyValidationStatus: 'untested',
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(and(eq(providers.id, id), eq(providers.userId, userId), eq(providers.legacyIsActive, true)));
  },

  async applyDiagnostic(userId: string, id: string, diagnostic: ProviderDiagnosticResult, input: {
    selectedModel?: string | undefined;
    discoveredModels?: DiscoveredModel[] | undefined;
    capabilities?: ProviderCapabilities | undefined;
  } = {}): Promise<ProviderRecord | undefined> {
    const status = statusFromDiagnostic(diagnostic);
    const [row] = await database.update(providers).set({
      status,
      isReady: diagnostic.success,
      ...(input.selectedModel !== undefined ? {
        selectedModel: input.selectedModel,
        legacyDefaultModel: input.selectedModel
      } : {}),
      ...(input.discoveredModels ? { discoveredModels: input.discoveredModels } : {}),
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      lastCheckStatus: diagnostic.status,
      lastCheckCode: diagnostic.providerCode ?? `provider_${diagnostic.status}`,
      lastCheckMessage: diagnostic.message.slice(0, 1200),
      lastCheckedAt: sql`CURRENT_TIMESTAMP`,
      lastLatencyMs: diagnostic.latencyMs ?? null,
      failureCount: diagnostic.success ? 0 : sql`${providers.failureCount} + 1`,
      nextRetryAt: diagnostic.retryable ? new Date(Date.now() + 60_000).toISOString() : null,
      legacyValidationStatus: legacyStatus(status),
      legacyValidationErrorCode: diagnostic.success ? null : `provider_${diagnostic.status}`,
      legacyValidatedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(and(eq(providers.id, id), eq(providers.userId, userId), eq(providers.legacyIsActive, true))).returning();
    return row ? record(row) : undefined;
  },

  async replaceDiscoveredModels(userId: string, providerId: string, models: DiscoveredModel[], expiresAt: string): Promise<void> {
    await database.transaction(async (tx) => {
      await tx.delete(providerModels).where(and(eq(providerModels.providerId, providerId), eq(providerModels.userId, userId)));
      if (models.length > 0) {
        await tx.insert(providerModels).values(models.map((model) => ({
          id: randomUUID(),
          providerId,
          userId,
          modelId: model.id,
          ...(model.name ? { name: model.name } : {}),
          ...(model.ownedBy ? { ownedBy: model.ownedBy } : {}),
          ...(model.contextLength !== undefined ? { contextLength: model.contextLength } : {}),
          capabilities: model.capabilities ?? {},
          expiresAt
        })));
      }
      await tx.update(providers).set({ discoveredModels: models, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(providers.id, providerId), eq(providers.userId, userId)));
    });
  },

  async setSelectedModel(userId: string, id: string, model: string): Promise<void> {
    await database.update(providers).set({
      selectedModel: model,
      legacyDefaultModel: model,
      status: 'draft',
      isReady: false,
      legacyValidationStatus: 'untested',
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(and(eq(providers.id, id), eq(providers.userId, userId), eq(providers.legacyIsActive, true)));
  },

  async disable(userId: string, id: string): Promise<boolean> {
    const rows = await database.update(providers).set({
      status: 'disabled',
      isEnabled: false,
      isReady: false,
      legacyIsActive: false,
      legacyValidationStatus: 'untested',
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(and(eq(providers.id, id), eq(providers.userId, userId), eq(providers.legacyIsActive, true))).returning({ id: providers.id });
    return rows.length > 0;
  },

  async countForUser(userId: string): Promise<{ total: number; ready: number }> {
    const rows = await database.select({ status: providers.status, count: sql<number>`count(*)::int` })
      .from(providers)
      .where(and(eq(providers.userId, userId), eq(providers.legacyIsActive, true)))
      .groupBy(providers.status);
    return {
      total: rows.reduce((sum, item) => sum + item.count, 0),
      ready: rows.filter((item) => item.status === 'ready').reduce((sum, item) => sum + item.count, 0)
    };
  },

  async findManyOwned(userId: string, ids: string[]): Promise<ProviderRecord[]> {
    if (ids.length === 0) return [];
    const rows = await database.select().from(providers).where(and(
      eq(providers.userId, userId),
      inArray(providers.id, ids),
      eq(providers.legacyIsActive, true)
    ));
    return rows.map(record);
  }
};
