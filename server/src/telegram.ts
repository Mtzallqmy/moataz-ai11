import TelegramBot, { type Message } from 'node-telegram-bot-api';
import { get, query, run } from './db.js';
import { decrypt } from './crypto.js';
import { complete } from './llm.js';
import { logger } from './logger.js';
import { redactText } from './redaction.js';

export type TelegramStatus = {
  enabled: boolean;
  botCount: number;
  configuredCount: number;
  discoveryOnlyCount: number;
};

export type TelegramController = TelegramStatus & {
  close: () => Promise<void>;
};

type IntegrationRow = {
  id: string;
  user_id: string;
  token_enc: string;
  meta: string | null;
};

type ProviderRow = {
  id: string;
  type: string;
  api_key_enc: string;
  base_url: string | null;
  default_model: string;
  name: string;
};

type DiscoveredChat = {
  id: string;
  type?: string;
  title?: string;
  username?: string;
  lastSeenAt: string;
};

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function allowedChatIds(meta: Record<string, unknown>): Set<string> {
  const values: unknown[] = Array.isArray(meta.allowedChatIds)
    ? meta.allowedChatIds
    : meta.chatId !== undefined
      ? [meta.chatId]
      : [];
  return new Set(
    values
      .filter((value) => typeof value === 'string' || typeof value === 'number')
      .map((value) => String(value).trim())
      .filter((value) => /^-?\d{1,24}$/.test(value))
  );
}

export function telegramAllowsChat(meta: Record<string, unknown>, chatId: string): boolean {
  return meta.allowAllChats === true || allowedChatIds(meta).has(chatId);
}

function discoveredChatFromMessage(message: Message): DiscoveredChat {
  const title = message.chat.type === 'private'
    ? [message.chat.first_name, message.chat.last_name].filter(Boolean).join(' ').trim()
    : message.chat.title?.trim() ?? '';
  return {
    id: String(message.chat.id),
    type: message.chat.type,
    ...(title ? { title: title.slice(0, 160) } : {}),
    ...(message.chat.username ? { username: message.chat.username.slice(0, 80) } : {}),
    lastSeenAt: new Date().toISOString()
  };
}

export function mergeDiscoveredChatMeta(meta: Record<string, unknown>, chat: DiscoveredChat): Record<string, unknown> {
  const existing = Array.isArray(meta.discoveredChats)
    ? meta.discoveredChats.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item))
    : [];
  const next = [
    chat,
    ...existing.filter((item) => String(item.id ?? '') !== chat.id)
  ].slice(0, 20);
  return { ...meta, discoveredChats: next };
}

async function recordDiscoveredChat(row: IntegrationRow, message: Message): Promise<void> {
  const latest = await get<{ meta: string | null }>('SELECT meta FROM integrations WHERE id = ? AND user_id = ? AND is_active = 1', [row.id, row.user_id]);
  if (!latest) return;
  const meta = mergeDiscoveredChatMeta(parseMeta(latest.meta), discoveredChatFromMessage(message));
  await run('UPDATE integrations SET meta = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [JSON.stringify(meta), row.id, row.user_id]);
  row.meta = JSON.stringify(meta);
}

async function providerForTelegram(userId: string, meta: Record<string, unknown>): Promise<ProviderRow | undefined> {
  const requested = typeof meta.providerId === 'string' ? meta.providerId : undefined;
  if (requested) {
    const selected = await get<ProviderRow>(
      `SELECT id, type, api_key_enc, base_url, default_model, name
       FROM providers WHERE id = ? AND user_id = ? AND is_active = 1 AND validation_status = 'verified'`,
      [requested, userId]
    );
    if (selected) return selected;
  }
  const providers = await query<ProviderRow>(
    `SELECT id, type, api_key_enc, base_url, default_model, name
     FROM providers WHERE user_id = ? AND is_active = 1 AND validation_status = 'verified'
     ORDER BY validated_at DESC, created_at DESC LIMIT 1`,
    [userId]
  );
  return providers[0];
}

type ConfiguredBot = { bot: TelegramBot; discoveryOnly: boolean };

async function configureBot(row: IntegrationRow, token: string): Promise<ConfiguredBot | undefined> {
  const initialMeta = parseMeta(row.meta);
  const allowed = allowedChatIds(initialMeta);
  const discoveryOnly = allowed.size === 0 && initialMeta.allowAllChats !== true;
  if (discoveryOnly) {
    logger.info('telegram_discovery_mode', { integrationId: row.id, reason: 'no_allowed_chat_ids' });
  }

  const bot = new TelegramBot(token, { polling: false });
  try {
    const identity = await bot.getMe();
    logger.info('telegram_bot_verified', { integrationId: row.id, botId: identity.id, username: identity.username });
  } catch (error) {
    logger.error('telegram_integration_invalid', {
      integrationId: row.id,
      error: redactText(error instanceof Error ? error.message : String(error))
    });
    return undefined;
  }

  const lastMessageAt = new Map<string, number>();
  const discoveryNoticeSent = new Set<string>();
  bot.on('message', (message: Message) => {
    void (async () => {
      const chatId = String(message.chat.id);
      await recordDiscoveredChat(row, message).catch((error) => logger.warn('telegram_discovery_save_failed', {
        integrationId: row.id,
        error: redactText(error instanceof Error ? error.message : String(error))
      }));

      const meta = parseMeta(row.meta);
      if (!telegramAllowsChat(meta, chatId)) {
        logger.info('telegram_chat_discovered', { integrationId: row.id, chatId });
        if (!discoveryNoticeSent.has(chatId)) {
          discoveryNoticeSent.add(chatId);
          await bot.sendMessage(
            message.chat.id,
            `تم اكتشاف هذه المحادثة. Chat ID: ${chatId}\nأضف هذا المعرّف إلى قائمة المحادثات المسموحة داخل Moataz AI ثم أعد تحميل التكامل.`
          ).catch(() => undefined);
        }
        return;
      }
      if (!message.text) return;
      if (message.text.length > 4000) {
        await bot.sendMessage(message.chat.id, 'Message is too long.');
        return;
      }
      const now = Date.now();
      if (now - (lastMessageAt.get(chatId) ?? 0) < 1000) return;
      lastMessageAt.set(chatId, now);

      try {
        const provider = await providerForTelegram(row.user_id, meta);
        if (!provider) {
          await bot.sendMessage(message.chat.id, 'لا يوجد مزوّد ذكاء اصطناعي تم اختباره بنجاح. أضف مزوّدًا واضغط اختبار الاتصال أولًا.');
          return;
        }
        const text = await complete(
          {
            type: provider.type,
            apiKey: decrypt(provider.api_key_enc),
            ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
            defaultModel: provider.default_model,
            name: provider.name
          },
          [
            { role: 'system', content: 'You are Moataz AI Telegram bot. Reply in the user language, briefly and helpfully.' },
            { role: 'user', content: message.text }
          ]
        );
        await bot.sendMessage(message.chat.id, text.slice(0, 4000));
      } catch (error) {
        logger.error('telegram_message_failed', {
          integrationId: row.id,
          error: redactText(error instanceof Error ? error.message : String(error))
        });
        await bot.sendMessage(message.chat.id, 'تعذر معالجة الرسالة. افحص حالة المزوّد والنموذج والرصيد من صفحة المزوّدات.').catch(() => undefined);
      }
    })();
  });

  bot.on('polling_error', (error) => logger.error('telegram_polling_error', {
    integrationId: row.id,
    error: redactText(error.message)
  }));

  try {
    await bot.startPolling();
    return { bot, discoveryOnly };
  } catch (error) {
    logger.error('telegram_polling_start_failed', {
      integrationId: row.id,
      error: redactText(error instanceof Error ? error.message : String(error))
    });
    return undefined;
  }
}

export async function startTelegramPolling(): Promise<TelegramController> {
  const rows = await query<IntegrationRow>("SELECT id, user_id, token_enc, meta FROM integrations WHERE type = ? AND is_active = 1 AND validation_status = 'verified'", ['telegram']);
  const uniqueTokens = new Set<string>();
  const configured: Array<Promise<ConfiguredBot | undefined>> = [];
  for (const row of rows) {
    const token = decrypt(row.token_enc);
    if (uniqueTokens.has(token)) {
      logger.warn('telegram_duplicate_token_skipped', { integrationId: row.id });
      continue;
    }
    uniqueTokens.add(token);
    configured.push(configureBot(row, token));
  }
  const running = (await Promise.all(configured)).filter((entry): entry is ConfiguredBot => entry !== undefined);
  const status: TelegramStatus = {
    enabled: running.length > 0,
    botCount: running.length,
    configuredCount: rows.length,
    discoveryOnlyCount: running.filter((entry) => entry.discoveryOnly).length
  };

  return {
    ...status,
    close: async () => {
      await Promise.all(running.map(async ({ bot }) => {
        try {
          await bot.stopPolling({ cancel: true });
        } catch (error) {
          logger.warn('telegram_stop_failed', { error: redactText(error instanceof Error ? error.message : String(error)) });
        }
      }));
    }
  };
}
