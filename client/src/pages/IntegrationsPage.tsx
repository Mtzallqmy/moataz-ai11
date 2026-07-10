import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState, Notice, PageHeader, SpinnerLabel, StatusBadge } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { IntegrationSummary } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type IntegrationType = 'github' | 'telegram';
type IntegrationForm = { type: IntegrationType; name: string; token: string; allowedChatIds: string };

const emptyForm: IntegrationForm = { type: 'github', name: '', token: '', allowedChatIds: '' };

function chatIdsFrom(integration: IntegrationSummary): string {
  const values = integration.meta?.allowedChatIds;
  return Array.isArray(values) ? values.map(String).join(', ') : '';
}

export function IntegrationsPage({ request, t, language }: { request: Request; t: T; language: Language }) {
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [form, setForm] = useState<IntegrationForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [identity, setIdentity] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await request<{ integrations: IntegrationSummary[] }>('/api/integrations');
      setIntegrations(response.integrations);
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    }
  }, [language, request]);

  useEffect(() => { void load(); }, [load]);

  const meta = () => form.type === 'telegram'
    ? { allowedChatIds: form.allowedChatIds.split(',').map((value) => value.trim()).filter(Boolean) }
    : {};

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
    setIdentity(null);
  };

  const testDraft = async () => {
    if (!form.token.trim()) {
      setNotice({ tone: 'error', text: language === 'ar' ? 'أدخل التوكن أولًا.' : 'Enter the token first.' });
      return;
    }
    setBusy('test');
    setNotice(null);
    setIdentity(null);
    try {
      const response = await request<{ identity: Record<string, unknown> }>('/api/integrations/test', {
        method: 'POST', body: JSON.stringify({ type: form.type, token: form.token.trim() })
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
    setForm({ type: integration.type, name: integration.name, token: '', allowedChatIds: chatIdsFrom(integration) });
    setIdentity(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const testSaved = async (id: string) => {
    setBusy(`test-${id}`);
    setNotice(null);
    try {
      const response = await request<{ identity: Record<string, unknown>; telegram?: { enabled: boolean; botCount: number } }>(`/api/integrations/${id}/test`, { method: 'POST', body: '{}' });
      setIdentity(response.identity);
      const suffix = response.telegram?.enabled
        ? (language === 'ar' ? ` — تم تشغيل ${response.telegram.botCount} بوت` : ` — ${response.telegram.botCount} bot(s) running`)
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

  return (
    <div className="page-stack">
      <PageHeader eyebrow={t('settings')} title={t('integrations')} description={language === 'ar' ? 'احفظ التوكن مشفرًا ثم اختبره فعليًا. ستظهر رسالة GitHub أو Telegram الحقيقية عند الفشل.' : 'Save the encrypted token, then test it. Real GitHub or Telegram errors are displayed.'} />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}><pre>{notice.text}</pre></Notice>}
      <section className="panel">
        <div className="section-heading"><div><h2>{editingId ? t('edit') : t('addIntegration')}</h2><p>{form.type === 'telegram' ? 'BotFather token' : 'Fine-grained or classic personal access token'}</p></div>{editingId && <button type="button" className="ghost" onClick={reset}>{t('cancel')}</button>}</div>
        <form onSubmit={save} className="form-grid">
          <label><span>{t('type')}</span><select value={form.type} disabled={editingId !== null} onChange={(event) => setForm({ type: event.target.value as IntegrationType, name: '', token: '', allowedChatIds: '' })}><option value="github">GitHub</option><option value="telegram">Telegram</option></select></label>
          <label><span>{t('name')}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label className="span-2"><span>{t('token')}</span><input type="password" autoComplete="new-password" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} required={!editingId} placeholder={editingId ? (language === 'ar' ? 'اتركه فارغًا للاحتفاظ بالتوكن الحالي' : 'Leave blank to keep the current token') : ''} /></label>
          {form.type === 'telegram' && <label className="span-2"><span>{t('allowedChatIds')}</span><input inputMode="text" value={form.allowedChatIds} onChange={(event) => setForm({ ...form, allowedChatIds: event.target.value })} placeholder="123456789, -1001234567890" /><small>{t('allowedChatIdsHint')}</small></label>}
          <div className="form-actions span-2"><button type="button" className="secondary" onClick={() => { void testDraft(); }} disabled={busy !== null || !form.token.trim()}><SpinnerLabel active={busy === 'test'} activeText={t('testing')} idleText={t('testConnection')} /></button><button type="submit" disabled={busy !== null}><SpinnerLabel active={busy === 'save'} activeText={t('saving')} idleText={editingId ? t('save') : t('addIntegration')} /></button></div>
        </form>
        {identity && <div className="identity-card"><strong>{t('integrationIdentity')}</strong><dl>{Object.entries(identity).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl></div>}
      </section>

      <section className="panel">
        <div className="section-heading"><div><h2>{t('integrations')}</h2><p>{integrations.length}</p></div><button type="button" className="ghost" onClick={() => { void load(); }}>{t('refresh')}</button></div>
        {integrations.length === 0 ? <EmptyState title={t('noIntegrations')} /> : <div className="resource-list">{integrations.map((integration) => {
          const integrationIdentity = integration.meta?.identity;
          const identityLabel = integrationIdentity !== null && typeof integrationIdentity === 'object' && !Array.isArray(integrationIdentity)
            ? String((integrationIdentity as Record<string, unknown>).username ?? (integrationIdentity as Record<string, unknown>).login ?? '')
            : '';
          return <article className="resource-card" key={integration.id}><div className="resource-main"><div className="resource-title"><strong>{integration.name}</strong><StatusBadge status={integration.validation_status} t={t} /></div><p>{integration.type}</p>{identityLabel && <small>{identityLabel}</small>}{integration.type === 'telegram' && chatIdsFrom(integration) && <small>{chatIdsFrom(integration)}</small>}{integration.validation_error_code && <code>{integration.validation_error_code}</code>}</div><div className="resource-actions"><button type="button" className="secondary" onClick={() => { void testSaved(integration.id); }} disabled={busy !== null}><SpinnerLabel active={busy === `test-${integration.id}`} activeText={t('testing')} idleText={t('testConnection')} /></button><button type="button" className="ghost" onClick={() => edit(integration)} disabled={busy !== null}>{t('edit')}</button><button type="button" className="danger ghost" onClick={() => { void remove(integration.id); }} disabled={busy !== null}>{t('delete')}</button></div></article>;
        })}</div>}
      </section>
    </div>
  );
}
