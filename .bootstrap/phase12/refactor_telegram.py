from pathlib import Path

path = Path('server/src/telegram.ts')
text = path.read_text()


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, found {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)

replace_once(
"""import { get, query, run } from './db.js';
""",
"""import { diagnoseProviderError } from './providers/diagnostics.js';
import { integrationsRepository, type IntegrationRecord } from './repositories/integrations.repository.js';
import { providersRepository, type ProviderRecord } from './repositories/providers.repository.js';
import { usersRepository } from './repositories/users.repository.js';
import { providersService } from './services/providers.service.js';
""")
replace_once("import { failedProviderDiagnostic } from './provider-diagnostics.js';\n", '')

start = text.index('type IntegrationRow = {')
end = text.index('type DiscoveredChat = {')
text = text[:start] + "type IntegrationRow = IntegrationRecord;\ntype ProviderRow = ProviderRecord;\n\n" + text[end:]

replace_once(
"""function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
""",
"""function parseMeta(raw: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
""")

replace_once(
"""async function recordDiscoveredChat(row: IntegrationRow, message: Message): Promise<void> {
  const latest = await get<{ meta: string | null }>('SELECT meta FROM integrations WHERE id = ? AND user_id = ? AND is_active = 1', [row.id, row.user_id]);
  if (!latest) return;
  const meta = mergeDiscoveredChatMeta(parseMeta(latest.meta), discoveredChatFromMessage(message));
  await run('UPDATE integrations SET meta = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [JSON.stringify(meta), row.id, row.user_id]);
  row.meta = JSON.stringify(meta);
}
""",
"""async function recordDiscoveredChat(row: IntegrationRow, message: Message): Promise<void> {
  const latest = await integrationsRepository.findOwned(row.user_id, row.id);
  if (!latest) return;
  const meta = mergeDiscoveredChatMeta(latest.meta, discoveredChatFromMessage(message));
  await integrationsRepository.updateMeta(row.user_id, row.id, meta);
  row.meta = meta;
}
""")

replace_once(
"""async function persistSession(row: IntegrationRow, chatId: string, session: TelegramSession): Promise<void> {
  const latest = await get<{ meta: string | null }>('SELECT meta FROM integrations WHERE id = ? AND user_id = ? AND is_active = 1', [row.id, row.user_id]);
  if (!latest) return;
  const meta = parseMeta(latest.meta);
  const current = objectRecord(meta.chatPreferences);
  const ordered = Object.entries(current).filter(([id]) => id !== chatId).slice(0, 19);
  const preference: Record<string, unknown> = { mode: session.mode };
  if (session.providerId) preference.providerId = session.providerId;
  const chatPreferences = Object.fromEntries([[chatId, preference], ...ordered]);
  const next = { ...meta, chatPreferences };
  await run('UPDATE integrations SET meta = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [JSON.stringify(next), row.id, row.user_id]);
  row.meta = JSON.stringify(next);
}
""",
"""async function persistSession(row: IntegrationRow, chatId: string, session: TelegramSession): Promise<void> {
  const latest = await integrationsRepository.findOwned(row.user_id, row.id);
  if (!latest) return;
  const current = objectRecord(latest.meta.chatPreferences);
  const ordered = Object.entries(current).filter(([id]) => id !== chatId).slice(0, 19);
  const preference: Record<string, unknown> = { mode: session.mode };
  if (session.providerId) preference.providerId = session.providerId;
  const chatPreferences = Object.fromEntries([[chatId, preference], ...ordered]);
  const next = { ...latest.meta, chatPreferences };
  await integrationsRepository.updateMeta(row.user_id, row.id, next);
  row.meta = next;
}
""")

provider_start = text.index('async function providerForTelegram')
provider_end = text.index('function pageUrl', provider_start)
replacement = """async function providerForTelegram(userId: string, meta: Record<string, unknown>, preferredId?: string): Promise<ProviderRow | undefined> {
  const requested = preferredId ?? (typeof meta.providerId === 'string' ? meta.providerId : undefined);
  if (requested) {
    const selected = await providersRepository.findOwned(userId, requested);
    if (selected?.is_ready && selected.status === 'ready' && selected.is_enabled) return selected;
  }
  return (await providersRepository.listReadyForUser(userId))[0];
}

function providerObject(row: ProviderRow): Provider {
  return {
    type: row.type,
    apiKey: decrypt(row.api_key_enc),
    ...(row.normalized_base_url ? { baseUrl: row.normalized_base_url } : {}),
    defaultModel: row.selected_model ?? row.default_model,
    name: row.name
  };
}

async function roleForUser(userId: string): Promise<ToolRole> {
  return (await usersRepository.findById(userId))?.role === 'admin' ? 'admin' : 'user';
}

async function integrationsForUser(userId: string): Promise<IntegrationCredential[]> {
  return (await integrationsRepository.listVerified(userId)).map((entry) => ({
    type: entry.type,
    token: decrypt(entry.token_enc),
    meta: entry.meta
  }));
}

"""
text = text[:provider_start] + replacement + text[provider_end:]

error_start = text.index('function explicitProviderError')
error_end = text.index('async function sendStatus', error_start)
text = text[:error_start] + """function explicitProviderError(providerType: string, error: unknown): string {
  const diagnostic = diagnoseProviderError(error);
  const details = error instanceof AppError ? objectRecord(error.details) : {};
  const providerMessage = typeof details.providerMessage === 'string'
    ? `\nرسالة المزوّد: ${redactText(details.providerMessage).slice(0, 700)}`
    : '';
  return `❌ فشل المزوّد ${providerType}\n${diagnostic.userMessageAr}${providerMessage}\nالحالة: ${diagnostic.status}\nقابل لإعادة المحاولة: ${diagnostic.retryable ? 'نعم' : 'لا'}`;
}

""" + text[error_end:]

status_start = text.index('async function sendStatus')
status_end = text.index('function toolsText', status_start)
status_replacement = """async function sendStatus(bot: TelegramBot, row: IntegrationRow, chatId: number, session: TelegramSession): Promise<void> {
  const providers = await providersRepository.listForUser(row.user_id);
  const integrations = await integrationsRepository.listForUser(row.user_id);
  const selected = providers.find((provider) => provider.id === session.providerId)
    ?? providers.find((provider) => provider.is_ready && provider.status === 'ready');
  const readyProviders = providers.filter((provider) => provider.is_ready && provider.status === 'ready').length;
  const verifiedIntegrations = integrations.filter((integration) => integration.validation_status === 'verified');
  const integrationTypes = [...new Set(verifiedIntegrations.map((integration) => integration.type))];
  const text = [
    '📊 حالة Moataz AI',
    `الوضع: ${session.mode === 'agent' ? 'Agent — الأدوات مفعلة' : 'Chat — محادثة فقط'}`,
    `المزوّد الحالي: ${selected ? `${selected.name} / ${selected.selected_model ?? selected.default_model}` : 'لا يوجد مزوّد جاهز'}`,
    `المزوّدات: ${readyProviders} جاهز من ${providers.length}`,
    `التكاملات المتحققة: ${integrationTypes.join('، ') || 'لا يوجد'}`,
    `البحث: ${integrationTypes.some((type) => type === 'brave_search' || type === 'tavily') ? 'جاهز' : 'يحتاج Brave أو Tavily'}`,
    `GitHub: ${integrationTypes.includes('github') ? 'جاهز' : 'غير مهيأ'}`,
    `Sandbox: ${integrationTypes.includes('sandbox') ? 'جاهز خارجيًا' : 'غير مهيأ'}`,
    'نوع الخطة المجانية أو المدفوعة لا يُخمن؛ نتيجة الفحص تعرض فقط ما أثبته رد المزوّد.'
  ].join('\n');
  await sendChunks(bot, chatId, text, true);
}

async function sendProviders(bot: TelegramBot, row: IntegrationRow, chatId: number, session: TelegramSession): Promise<void> {
  const providers = await providersRepository.listForUser(row.user_id);
  const ready = providers.filter((provider) => provider.is_ready && provider.status === 'ready' && provider.is_enabled);
  if (ready.length === 0) {
    const failures = providers.filter((provider) => provider.last_check_code)
      .map((provider) => `• ${provider.name}: ${provider.last_check_code}`).join('\n');
    await bot.sendMessage(chatId, `لا يوجد مزوّد اجتاز فحص inference حقيقي.${failures ? `\n${failures}` : ''}`, {
      reply_markup: { inline_keyboard: [[{ text: 'فتح إعدادات المزوّدات', url: pageUrl('providers') }]] }
    });
    return;
  }
  await bot.sendMessage(chatId, 'اختر المزوّد الذي سيستخدمه هذا Chat ID:', {
    reply_markup: {
      inline_keyboard: [
        ...ready.slice(0, 20).map((provider) => [{
          text: `${session.providerId === provider.id ? '✅ ' : ''}${provider.name} · ${provider.selected_model ?? provider.default_model}`,
          callback_data: `provider:${provider.id}`
        }]),
        [{ text: 'فتح صفحة المزوّدات', url: pageUrl('providers') }],
        [{ text: 'رجوع', callback_data: 'menu:home' }]
      ]
    }
  });
}

async function diagnoseProvider(bot: TelegramBot, row: IntegrationRow, chatId: number, session: TelegramSession): Promise<void> {
  const providerRow = await providerForTelegram(row.user_id, parseMeta(row.meta), session.providerId);
  if (!providerRow) {
    await bot.sendMessage(chatId, 'لا يوجد مزوّد جاهز. احفظه كمسودة، اختر نموذجًا محددًا، ثم نفذ إعادة الفحص.', {
      reply_markup: { inline_keyboard: [[{ text: 'إعداد المزوّدات', url: pageUrl('providers') }]] }
    });
    return;
  }
  await bot.sendChatAction(chatId, 'typing');
  try {
    const result = await providersService.retest(row.user_id, providerRow.id);
    await sendChunks(bot, chatId, [
      `✅ ${result.provider.name} جاهز`,
      `النموذج: ${result.provider.selected_model ?? result.provider.default_model}`,
      `الحالة: ${result.diagnostic.status}`,
      `الوصول: ${String(result.diagnostic.providerReachable)}`,
      `صلاحية المفتاح: ${String(result.diagnostic.keyValid)}`,
      `النموذج متاح: ${String(result.diagnostic.modelAvailable)}`,
      `الزمن: ${result.diagnostic.latencyMs ?? 0}ms`,
      result.diagnostic.userMessageAr
    ].join('\n'), true);
  } catch (error) {
    await sendChunks(bot, chatId, explicitProviderError(providerRow.type, error), true);
  }
}

"""
text = text[:status_start] + status_replacement + text[status_end:]

replace_once(
"""    const provider = await get<ProviderRow>(
      `SELECT id, type, api_key_enc, base_url, default_model, name FROM providers
       WHERE id = ? AND user_id = ? AND is_active = 1 AND validation_status = 'verified'`,
      [providerId, row.user_id]
    );
""",
"""    const provider = await providersRepository.findOwned(row.user_id, providerId);
""")
replace_once(
"""    if (!provider) {
      await bot.sendMessage(message.chat.id, 'المزوّد غير متاح أو لم ينجح اختباره.');
      return;
    }
""",
"""    if (!provider?.is_ready || provider.status !== 'ready' || !provider.is_enabled) {
      await bot.sendMessage(message.chat.id, 'المزوّد غير جاهز أو لم ينجح فحص inference الحقيقي.');
      return;
    }
""")
replace_once('`✅ تم اختيار ${provider.name}\\nالنموذج: ${provider.default_model}`', '`✅ تم اختيار ${provider.name}\\nالنموذج: ${provider.selected_model ?? provider.default_model}`')
replace_once('completeAgentStep(provider, messages, providerRow.default_model, availableTools)', 'completeAgentStep(provider, messages, providerRow.selected_model ?? providerRow.default_model, availableTools)')
replace_once('step = await completeAgentStep(provider, messages, providerRow.default_model, availableTools);', 'step = await completeAgentStep(provider, messages, providerRow.selected_model ?? providerRow.default_model, availableTools);')
replace_once(
"""  const rows = await query<IntegrationRow>("SELECT id, user_id, token_enc, meta FROM integrations WHERE type = ? AND is_active = 1 AND validation_status = 'verified'", ['telegram']);
""",
"""  const rows = await integrationsRepository.listAllVerifiedByType('telegram');
""")

path.write_text(text)
