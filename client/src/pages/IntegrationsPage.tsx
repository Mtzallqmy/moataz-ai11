import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, Notice, PageHeader, SpinnerLabel, StatusBadge } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { DiscoveredTelegramChat, IntegrationSummary, IntegrationType } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type IntegrationForm = {
  type: IntegrationType;
  name: string;
  token: string;
  allowedChatIds: string;
  allowAllChats: boolean;
  baseUrl: string;
};

const emptyForm: IntegrationForm = { type: 'github', name: '', token: '', allowedChatIds: '', allowAllChats: false, baseUrl: '' };

const labels: Record<IntegrationType, string> = {
  github: 'GitHub',
  telegram: 'Telegram Bot',
  brave_search: 'Brave Search',
  tavily: 'Tavily Search',
  sandbox: 'External Sandbox'
};

function chatIdsFrom(integration: IntegrationSummary): string {
  const values = integration.meta?.allowedChatIds;
  return Array.isArray(values) ? values.map(String).join(', ') : '';
}

function discoveredChats(integration: IntegrationSummary): DiscoveredTelegramChat[] {
  return Array.isArray(integration.meta?.discoveredChats) ? integration.meta.discoveredChats : [];
}

function uniqueChatIds(input: string): string[] {
  return [...new Set(input.split(/[\s,]+/).map((value) => value.trim()).filter((value) => /^-?\d{1,24}$/.test(value)))];
}

export function IntegrationsPage({ request, t, language }: { request: Request; t: T; language: Language }) {
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [form, setForm] = useState<IntegrationForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [identity, setIdentity] = useState<Record<string, unknown> | null>(null);

  const editingIntegration = useMemo(() => integrations.find((integration) => integration.id === editingId), [editingId, integrations]);

  const load = useCallback(async () => {
    try {
      const response = await request<{ integrations: IntegrationSummary[] }>('/api/integrations');
      setIntegrations(response.integrations);
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    }
  }, [language, request]);

  useEffect(() => { void load(); }, [load]);

  const meta = () => {
    if (form.type === 'telegram') {
      return {
        allowedChatIds: uniqueChatIds(form.allowedChatIds),
        allowAllChats: form.allowAllChats,
        ...(editingIntegration?.meta?.discoveredChats ? { discoveredChats: editingIntegration.meta.discoveredChats } : {})
      };
    }
    if (form.type === 'sandbox') return { baseUrl: form.baseUrl.trim() };
    return {};
  };

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
    setIdentity(null);
  };

  const testDraft = async () => {
    if (!form.token.trim()) {
      setNotice({ tone: 'error', text: language === 'ar' ? 'أدخل التوكن أو المفتاح أولًا.' : 'Enter the token or key first.' });
      return;
    }
    if (form.type === 'sandbox' && !form.baseUrl.trim()) {
      setNotice({ tone: 'error', text: language === 'ar' ? 'أدخل رابط خدمة Sandbox.' : 'Enter the sandbox service URL.' });
      return;
    }
    setBusy('test');
    setNotice(null);
    setIdentity(null);
    try {
      const response = await request<{ identity: Record<string, unknown> }>('/api/integrations/test', {
        method: 'POST', body: JSON.stringify({ type: form.type, token: form.token.trim(), meta: meta() })
      });
      setIdentity(response.identity);
      setNotice({ tone: 'success', text: t('connectionSuccessful') });
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingId && !form.token.trim()) return;
    setBusy('save');
    setNotice(null);
    try {
      if (editingId) {
        await request(`/api/integrations/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name.trim(),
            ...(form.token.trim() ? { token: form.token.trim() } : {}),
            meta: meta()
          })
        });
      } else {
        await request('/api/integrations', {
          method: 'POST',
          body: JSON.stringify({ type: form.type, name: form.name.trim(), token: form.token.trim(), meta: meta() })
        });
      }
      reset();
      setNotice({ tone: 'success', text: t('integrationSaved') });
      await load();
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const edit = (integration: IntegrationSummary) => {
    setEditingId(integration.id);
    setForm({
      type: integration.type,
      name: integration.name,
      token: '',
      allowedChatIds: chatIdsFrom(integration),
      allowAllChats: integration.meta?.allowAllChats === true,
      baseUrl: typeof integration.meta?.baseUrl === 'string' ? integration.meta.baseUrl : ''
    });
    setIdentity(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const testSaved = async (id: string) => {
    setBusy(`test-${id}`);
    setNotice(null);
    try {
      const response = await request<{ identity: Record<string, unknown>; telegram?: { enabled: boolean; botCount: number; discoveryOnlyCount: number } }>(`/api/integrations/${id}/test`, { method: 'POST', body: '{}' });
      setIdentity(response.identity);
      const suffix = response.telegram?.enabled
        ? language === 'ar'
          ? ` — تم تشغيل ${response.telegram.botCount} بوت${response.telegram.discoveryOnlyCount > 0 ? ' في وضع اكتشاف المحادثات' : ''}`
          : ` — ${response.telegram.botCount} bot(s) running${response.telegram.discoveryOnlyCount > 0 ? ' in discovery mode' : ''}`
        : '';
      setNotice({ tone: 'success', text: `${t('connectionSuccessful')}${suffix}` });
      await load();
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const authorizeChat = async (integration: IntegrationSummary, chatId: string) => {
    setBusy(`allow-${integration.id}-${chatId}`);
    setNotice(null);
    try {
      const ids = [...new Set([...uniqueChatIds(chatIdsFrom(integration)), chatId])];
      await request(`/api/integrations/${integration.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ meta: { allowedChatIds: ids, allowAllChats: integration.meta?.allowAllChats === true, discoveredChats: discoveredChats(integration) } })
      });
      await request(`/api/integrations/${integration.id}/test`, { method: 'POST', body: '{}' });
      setNotice({ tone: 'success', text: language === 'ar' ? `تم السماح للمحادثة ${chatId} وإعادة تشغيل البوت.` : `Chat ${chatId} was allowed and the bot was reloaded.` });
      await load();
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(language === 'ar' ? 'حذف هذا التكامل؟' : 'Delete this integration?')) return;
    setBusy(`delete-${id}`);
    try {
      await request(`/api/integrations/${id}`, { method: 'DELETE' });
      if (editingId === id) reset();
      await load();
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const tokenHint = form.type === 'telegram'
    ? 'BotFather token'
    : form.type === 'github'
      ? 'Fine-grained or classic personal access token'
      : form.type === 'sandbox'
        ? (language === 'ar' ? 'توكن المصادقة لخدمة Sandbox الخارجية' : 'External sandbox bearer token')
        : (language === 'ar' ? 'مفتاح API لخدمة البحث' : 'Search API key');

  return (
    <div className="page-stack">
      <PageHeader eyebrow={t('settings')} title={t('integrations')} description={language === 'ar' ? 'GitHub وTelegram والبحث وSandbox خارجي. بعد السماح بالمحادثة يعرض البوت /menu بأزرار للمزوّدات والتشخيص والملفات والويب والأدوات والحالة.' : 'GitHub, Telegram, web search, and an external sandbox with real validation and encrypted storage.'} />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}><pre>{notice.text}</pre></Notice>}
      <section className="panel">
        <div className="section-heading"><div><h2>{editingId ? t('edit') : t('addIntegration')}</h2><p>{tokenHint}</p></div>{editingId && <button type="button" className="ghost" onClick={reset}>{t('cancel')}</button>}</div>
        <form onSubmit={save} className="form-grid">
          <label><span>{t('type')}</span><select value={form.type} disabled={editingId !== null} onChange={(event) => setForm({ ...emptyForm, type: event.target.value as IntegrationType })}>{Object.entries(labels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label>
          <label><span>{t('name')}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label className="span-2"><span>{t('token')}</span><input type="password" autoComplete="new-password" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} required={!editingId} placeholder={editingId ? (language === 'ar' ? 'اتركه فارغًا للاحتفاظ بالتوكن الحالي' : 'Leave blank to keep the current token') : ''} /></label>
          {form.type === 'sandbox' && <label className="span-2"><span>{t('baseUrl')}</span><input inputMode="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://sandbox.example.com" required /><small>{language === 'ar' ? 'يجب أن توفر الخدمة GET /health وPOST /v1/execute. لا يتم تشغيل Shell داخل حاوية Railway.' : 'The service must expose GET /health and POST /v1/execute. Shell is never run inside the Railway app container.'}</small></label>}
          {form.type === 'telegram' && <>
            <label className="span-2"><span>{t('allowedChatIds')}</span><input inputMode="text" value={form.allowedChatIds} onChange={(event) => setForm({ ...form, allowedChatIds: event.target.value })} placeholder="123456789, -1001234567890" /><small>{language === 'ar' ? 'يمكن تركه فارغًا أول مرة: اختبر التكامل، أرسل /start للبوت، ثم اضغط تحديث وستظهر المحادثة المكتشفة.' : 'You may leave this empty initially: test the integration, send /start to the bot, then refresh to see the discovered chat.'}</small></label>
            <label className="span-2 checkbox-row"><input type="checkbox" checked={form.allowAllChats} onChange={(event) => setForm({ ...form, allowAllChats: event.target.checked })} /><span>{language === 'ar' ? 'السماح لجميع المحادثات — غير موصى به للبوتات العامة' : 'Allow every chat — not recommended for public bots'}</span></label>
          </>}
          <div className="form-actions span-2"><button type="button" className="secondary" onClick={() => { void testDraft(); }} disabled={busy !== null || !form.token.trim()}><SpinnerLabel active={busy === 'test'} activeText={t('testing')} idleText={t('testConnection')} /></button><button type="submit" disabled={busy !== null}><SpinnerLabel active={busy === 'save'} activeText={t('saving')} idleText={editingId ? t('save') : t('addIntegration')} /></button></div>
        </form>
        {identity && <div className="identity-card"><strong>{t('integrationIdentity')}</strong><dl>{Object.entries(identity).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl></div>}
      </section>

      <section className="panel">
        <div className="section-heading"><div><h2>{t('integrations')}</h2><p>{integrations.length}</p></div><button type="button" className="ghost" onClick={() => { void load(); }}>{t('refresh')}</button></div>
        {integrations.length === 0 ? <EmptyState title={t('noIntegrations')} /> : <div className="resource-list">{integrations.map((integration) => {
          const integrationIdentity = integration.meta?.identity;
          const identityLabel = integrationIdentity !== null && typeof integrationIdentity === 'object' && !Array.isArray(integrationIdentity)
            ? String(integrationIdentity.username ?? integrationIdentity.login ?? integrationIdentity.service ?? '')
            : '';
          const chats = integration.type === 'telegram' ? discoveredChats(integration) : [];
          const allowed = new Set(uniqueChatIds(chatIdsFrom(integration)));
          return <article className="resource-card resource-card-wide" key={integration.id}>
            <div className="resource-main"><div className="resource-title"><strong>{integration.name}</strong><StatusBadge status={integration.validation_status} t={t} /></div><p>{labels[integration.type]}</p>{identityLabel && <small>{identityLabel}</small>}{integration.type === 'telegram' && <small>{chatIdsFrom(integration) || (language === 'ar' ? 'وضع اكتشاف المحادثات' : 'Chat discovery mode')}</small>}{integration.type === 'sandbox' && <small>{integration.meta?.baseUrl}</small>}{integration.validation_error_code && <code>{integration.validation_error_code}</code>}
              {chats.length > 0 && <div className="discovered-chats"><strong>{language === 'ar' ? 'المحادثات المكتشفة' : 'Discovered chats'}</strong>{chats.map((chat) => <div className="discovered-chat" key={chat.id}><span><b>{chat.title || chat.username || chat.type || 'Telegram'}</b><code>{chat.id}</code></span>{allowed.has(chat.id) ? <span className="status-badge verified">{language === 'ar' ? 'مسموح' : 'Allowed'}</span> : <button type="button" className="compact secondary" onClick={() => { void authorizeChat(integration, chat.id); }} disabled={busy !== null}><SpinnerLabel active={busy === `allow-${integration.id}-${chat.id}`} activeText={language === 'ar' ? 'إضافة…' : 'Adding…'} idleText={language === 'ar' ? 'السماح' : 'Allow'} /></button>}</div>)}</div>}
            </div>
            <div className="resource-actions"><button type="button" className="secondary" onClick={() => { void testSaved(integration.id); }} disabled={busy !== null}><SpinnerLabel active={busy === `test-${integration.id}`} activeText={t('testing')} idleText={t('testConnection')} /></button><button type="button" className="ghost" onClick={() => edit(integration)} disabled={busy !== null}>{t('edit')}</button><button type="button" className="danger ghost" onClick={() => { void remove(integration.id); }} disabled={busy !== null}>{t('delete')}</button></div>
          </article>;
        })}</div>}
      </section>
    </div>
  );
}
