import TelegramBot, { type Message } from 'node-telegram-bot-api';
import { query } from './db.js';
import { decrypt } from './crypto.js';
import { complete } from './llm.js';
import { logger } from './logger.js';
import { redactText } from './redaction.js';

export type TelegramController = {
  enabled: boolean;
  botCount: number;
  close: () => Promise<void>;
};

type IntegrationRow = {
  id: string;
  user_id: string;
  token_enc: string;
  meta: string | null;
};

type ProviderRow = {
  type: string;
  api_key_enc: string;
  base_url: string | null;
  default_model: string;
  name: string;
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
      .filter(Boolean)
  );
}

async function configureBot(row: IntegrationRow): Promise<TelegramBot | undefined> {
  const meta = parseMeta(row.meta);
  const allowed = allowedChatIds(meta);
  if (allowed.size === 0) {
    logger.warn('telegram_integration_skipped', { integrationId: row.id, reason: 'no_allowed_chat_ids' });
    return undefined;
  }

  const bot = new TelegramBot(decrypt(row.token_enc), { polling: false });
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
  bot.on('message', (message: Message) => {
    void (async () => {
      if (!message.text) return;
      const chatId = String(message.chat.id);
      if (!allowed.has(chatId)) {
        logger.warn('telegram_unauthorized_chat', { integrationId: row.id, chatId });
        return;
      }
      if (message.text.length > 4000) {
        await bot.sendMessage(message.chat.id, 'Message is too long.');
        return;
      }
      const now = Date.now();
      if (now - (lastMessageAt.get(chatId) ?? 0) < 1000) return;
      lastMessageAt.set(chatId, now);

      try {
        const providers = await query<ProviderRow>(
          'SELECT type, api_key_enc, base_url, default_model, name FROM providers WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC',
          [row.user_id]
        );
        const provider = providers[0];
        if (!provider) {
          await bot.sendMessage(message.chat.id, 'No AI provider is configured.');
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
        await bot.sendMessage(message.chat.id, 'Moataz AI could not process this message. Check the configured provider and try again.');
      }
    })();
  });

  bot.on('polling_error', (error) => logger.error('telegram_polling_error', {
    integrationId: row.id,
    error: redactText(error.message)
  }));

  try {
    await bot.startPolling();
    return bot;
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
  const configured = await Promise.all(rows.map(configureBot));
  const bots = configured.filter((bot): bot is TelegramBot => bot !== undefined);

  return {
    enabled: bots.length > 0,
    botCount: bots.length,
    close: async () => {
      await Promise.all(bots.map(async (bot) => {
        try {
          await bot.stopPolling({ cancel: true });
        } catch (error) {
          logger.warn('telegram_stop_failed', { error: redactText(error instanceof Error ? error.message : String(error)) });
        }
      }));
    }
  };
}
