import TelegramBot from 'node-telegram-bot-api';
import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { decrypt, encrypt } from '../crypto.js';
import { cryptoId } from '../database/ids.js';
import { AppError } from '../errors.js';
import { fetchWithValidatedRedirects, readLimitedText } from '../network.js';
import { integrationsRepository, type IntegrationRecord } from '../repositories/integrations.repository.js';
import { upstreamAppError } from '../upstream-errors.js';

export type IntegrationType = 'github' | 'telegram' | 'brave_search' | 'tavily' | 'sandbox';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeDiscoveredChats(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Array<Record<string, unknown>> => {
    const item = record(entry);
    const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id).trim() : '';
    if (!/^-?\d{1,24}$/.test(id)) return [];
    return [{
      id,
      ...(typeof item.type === 'string' ? { type: item.type.slice(0, 40) } : {}),
      ...(typeof item.title === 'string' ? { title: item.title.slice(0, 160) } : {}),
      ...(typeof item.username === 'string' ? { username: item.username.slice(0, 80) } : {}),
      ...(typeof item.lastSeenAt === 'string' ? { lastSeenAt: item.lastSeenAt } : {})
    }];
  }).slice(0, 20);
}

function normalizeTelegramPreferences(value: unknown): Record<string, { providerId?: string; mode: 'chat' | 'agent' }> {
  const root = record(value);
  return Object.fromEntries(Object.entries(root).flatMap(([chatId, raw]) => {
    const preference = record(raw);
    if (!/^-?\d{1,24}$/.test(chatId)) return [];
    const providerId = typeof preference.providerId === 'string' && /^[0-9a-f-]{36}$/i.test(preference.providerId)
      ? preference.providerId
      : undefined;
    const mode: 'chat' | 'agent' = preference.mode === 'chat' ? 'chat' : 'agent';
    return [[chatId, { ...(providerId ? { providerId } : {}), mode }]];
  }).slice(0, 20));
}

export function normalizeIntegrationMeta(type: IntegrationType, meta: Record<string, unknown>): Record<string, unknown> {
  if (type === 'github' || type === 'brave_search' || type === 'tavily') {
    return meta.identity !== null && typeof meta.identity === 'object' && !Array.isArray(meta.identity)
      ? { identity: meta.identity }
      : {};
  }
  if (type === 'sandbox') {
    const rawBaseUrl = typeof meta.baseUrl === 'string' ? meta.baseUrl.trim() : '';
    if (!rawBaseUrl) throw new AppError('sandbox_base_url_required', 422);
    let baseUrl: string;
    try {
      const url = new URL(rawBaseUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      baseUrl = url.toString().replace(/\/$/, '');
    } catch {
      throw new AppError('invalid_url', 422, 'The sandbox Base URL is invalid.');
    }
    return {
      baseUrl,
      ...(meta.identity !== null && typeof meta.identity === 'object' && !Array.isArray(meta.identity) ? { identity: meta.identity } : {})
    };
  }
  const raw = Array.isArray(meta.allowedChatIds) ? meta.allowedChatIds : meta.chatId !== undefined ? [meta.chatId] : [];
  const allowedChatIds = [...new Set(raw
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map((value) => String(value).trim())
    .filter((value) => /^-?\d{1,24}$/.test(value)))].slice(0, 100);
  return {
    allowedChatIds,
    ...(allowedChatIds[0] ? { chatId: allowedChatIds[0] } : {}),
    allowAllChats: meta.allowAllChats === true,
    discoveredChats: normalizeDiscoveredChats(meta.discoveredChats),
    chatPreferences: normalizeTelegramPreferences(meta.chatPreferences),
    ...(meta.identity !== null && typeof meta.identity === 'object' && !Array.isArray(meta.identity) ? { identity: meta.identity } : {})
  };
}

export function normalizeIntegrationToken(type: IntegrationType, rawToken: string): string {
  const token = rawToken.trim();
  if (!token || /\s/.test(token) || /^\[.*\]$/.test(token) || /^<.*>$/.test(token)) {
    throw new AppError(`${type}_token_invalid_format`, 422);
  }
  if (type === 'telegram' && !/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new AppError('telegram_token_invalid_format', 422);
  }
  if (type === 'github' && token.length < 20) throw new AppError('github_token_invalid_format', 422);
  return token;
}

async function jsonFromResponse(response: Response): Promise<Record<string, unknown>> {
  const raw = await readLimitedText(response, config.maxWebFetchBytes);
  try {
    const parsed = JSON.parse(raw) as unknown;
    return record(parsed);
  } catch {
    throw new AppError('integration_invalid_response', 502, 'The integration returned invalid JSON.', { upstreamStatus: response.status });
  }
}

export async function validateIntegration(type: IntegrationType, rawToken: string, rawMeta: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const token = normalizeIntegrationToken(type, rawToken);
  const meta = normalizeIntegrationMeta(type, rawMeta);
  try {
    if (type === 'github') {
      const response = await new Octokit({ auth: token }).request('GET /user');
      return { login: response.data.login, userId: response.data.id, displayName: response.data.name, avatarUrl: response.data.avatar_url };
    }
    if (type === 'telegram') {
      const bot = await new TelegramBot(token, { polling: false }).getMe();
      return { botId: bot.id, username: bot.username, displayName: bot.first_name, canJoinGroups: bot.can_join_groups, supportsInlineQueries: bot.supports_inline_queries };
    }
    if (type === 'brave_search') {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', 'OpenAI');
      url.searchParams.set('count', '1');
      const response = await fetchWithValidatedRedirects(url.toString(), {
        method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': token }
      }, { timeoutMs: config.webFetchTimeoutMs, maxRedirects: 0 });
      const payload = await jsonFromResponse(response);
      if (!response.ok) throw Object.assign(new Error('Brave Search validation failed.'), { status: response.status, response: { data: payload } });
      return { service: 'Brave Search', verified: true };
    }
    if (type === 'tavily') {
      const response = await fetchWithValidatedRedirects('https://api.tavily.com/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: token, query: 'OpenAI', max_results: 1, search_depth: 'basic' })
      }, { timeoutMs: config.webFetchTimeoutMs, maxRedirects: 0 });
      const payload = await jsonFromResponse(response);
      if (!response.ok) throw Object.assign(new Error('Tavily validation failed.'), { status: response.status, response: { data: payload } });
      return { service: 'Tavily', verified: true };
    }
    const baseUrl = String(meta.baseUrl ?? '').replace(/\/$/, '');
    const response = await fetchWithValidatedRedirects(`${baseUrl}/health`, {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    }, { timeoutMs: config.webFetchTimeoutMs, maxRedirects: 0 });
    const payload = await jsonFromResponse(response).catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error('Sandbox health check failed.'), { status: response.status, response: { data: payload } });
    return { service: 'External sandbox', verified: true, baseUrl };
  } catch (error) {
    throw upstreamAppError('integration', type, error);
  }
}

export function publicIntegration(row: IntegrationRecord) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    meta: row.meta,
    validation_status: row.validation_status,
    validation_error_code: row.validation_error_code,
    validated_at: row.validated_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export const integrationsService = {
  async list(userId: string) {
    return (await integrationsRepository.listForUser(userId)).map(publicIntegration);
  },
  async create(userId: string, input: { name: string; type: IntegrationType; token: string; meta: Record<string, unknown> }): Promise<IntegrationRecord> {
    const token = normalizeIntegrationToken(input.type, input.token);
    return integrationsRepository.create({
      id: cryptoId(), userId, name: input.name, type: input.type,
      encryptedToken: encrypt(token), meta: normalizeIntegrationMeta(input.type, input.meta)
    });
  },
  async update(userId: string, id: string, input: { name?: string; token?: string; meta?: Record<string, unknown> }): Promise<IntegrationRecord> {
    const existing = await integrationsRepository.findOwned(userId, id);
    if (!existing) throw new AppError('integration_not_found', 404);
    const token = input.token ? normalizeIntegrationToken(existing.type as IntegrationType, input.token) : decrypt(existing.token_enc);
    const meta = normalizeIntegrationMeta(existing.type as IntegrationType, { ...existing.meta, ...(input.meta ?? {}) });
    const updated = await integrationsRepository.update(userId, id, {
      name: input.name ?? existing.name, encryptedToken: encrypt(token), meta
    });
    if (!updated) throw new AppError('integration_not_found', 404);
    return updated;
  },
  async retest(userId: string, id: string): Promise<IntegrationRecord> {
    const existing = await integrationsRepository.findOwned(userId, id);
    if (!existing) throw new AppError('integration_not_found', 404);
    try {
      const identity = await validateIntegration(existing.type as IntegrationType, decrypt(existing.token_enc), existing.meta);
      const meta = normalizeIntegrationMeta(existing.type as IntegrationType, { ...existing.meta, identity });
      await integrationsRepository.setValidation(userId, id, { status: 'verified', meta });
    } catch (error) {
      await integrationsRepository.setValidation(userId, id, {
        status: 'failed', errorCode: error instanceof AppError ? error.code : 'integration_unknown'
      });
      throw error;
    }
    return (await integrationsRepository.findOwned(userId, id))!;
  },
  async disable(userId: string, id: string): Promise<void> {
    if (!await integrationsRepository.disable(userId, id)) throw new AppError('integration_not_found', 404);
  }
};
