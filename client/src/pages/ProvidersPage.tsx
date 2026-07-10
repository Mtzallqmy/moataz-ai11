import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState, Notice, PageHeader, SpinnerLabel, StatusBadge } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { ProviderSummary } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type ProviderForm = { name: string; type: string; defaultModel: string; baseUrl: string; apiKey: string };

const presets: Record<string, { baseUrl: string }> = {
  openai: { baseUrl: '' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1' },
  anthropic: { baseUrl: '' },
  gemini: { baseUrl: '' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1' },
  together: { baseUrl: 'https://api.together.xyz/v1' },
  deepseek: { baseUrl: 'https://api.deepseek.com' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1' }
};

const emptyForm: ProviderForm = { name: '', type: 'openrouter', defaultModel: '', baseUrl: presets.openrouter!.baseUrl, apiKey: '' };

export function ProvidersPage({ request, t, language }: { request: Request; t: T; language: Language }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await request<{ providers: ProviderSummary[] }>('/api/providers');
      setProviders(response.providers);
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    }
  }, [language, request]);

  useEffect(() => { void load(); }, [load]);

  const payload = () => ({
    name: form.name.trim(),
    type: form.type,
    defaultModel: form.defaultModel.trim(),
    ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {})
  });

  const testDraft = async () => {
    if (!form.apiKey.trim()) {
      setNotice({ tone: 'error', text: language === 'ar' ? 'أدخل مفتاح API لاختبار الاتصال.' : 'Enter an API key to test the connection.' });
      return;
    }
    setBusy('test');
    setNotice(null);
    try {
      const response = await request<{ responsePreview?: string }>('/api/providers/test', {
        method: 'POST',
        body: JSON.stringify({ type: form.type, model: form.defaultModel.trim(), apiKey: form.apiKey.trim(), ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}) })
      });
      setNotice({ tone: 'success', text: `${t('connectionSuccessful')}${response.responsePreview ? ` — ${response.responsePreview}` : ''}` });
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingId && !form.apiKey.trim()) return;
    setBusy('save');
    setNotice(null);
    try {
      if (editingId) {
        await request(`/api/providers/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload()) });
      } else {
        await request('/api/providers', { method: 'POST', body: JSON.stringify(payload()) });
      }
      setForm(emptyForm);
      setEditingId(null);
      setNotice({ tone: 'success', text: t('providerSaved') });
      await load();
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const testSaved = async (id: string) => {
    setBusy(`test-${id}`);
    setNotice(null);
    try {
      await request(`/api/providers/${id}/test`, { method: 'POST', body: '{}' });
      setNotice({ tone: 'success', text: t('connectionSuccessful') });
      await load();
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const edit = (provider: ProviderSummary) => {
    setEditingId(provider.id);
    setForm({ name: provider.name, type: provider.type, defaultModel: provider.default_model, baseUrl: provider.base_url ?? '', apiKey: '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (id: string) => {
    if (!window.confirm(language === 'ar' ? 'حذف المزوّد وفصله عن المحادثات؟' : 'Delete this provider and detach it from chats?')) return;
    setBusy(`delete-${id}`);
    try {
      await request(`/api/providers/${id}`, { method: 'DELETE' });
      if (editingId === id) { setEditingId(null); setForm(emptyForm); }
      await load();
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const changeType = (type: string) => {
    setForm((current) => ({ ...current, type, baseUrl: presets[type]?.baseUrl ?? '' }));
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow={t('settings')} title={t('providers')} description={language === 'ar' ? 'احفظ الإعداد أولًا أو اختبره مباشرة، وستظهر رسالة المزود الحقيقية عند الفشل.' : 'Save or test a provider and see the real upstream error when it fails.'} />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}><pre>{notice.text}</pre></Notice>}
      <section className="panel">
        <div className="section-heading"><div><h2>{editingId ? t('edit') : t('addProvider')}</h2><p>{language === 'ar' ? 'لا يُرسل المفتاح إلى أي جهة إلا عند الضغط على اختبار الاتصال أو استخدام المحادثة.' : 'The key is sent upstream only when testing or chatting.'}</p></div>{editingId && <button type="button" className="ghost" onClick={() => { setEditingId(null); setForm(emptyForm); }}>{t('cancel')}</button>}</div>
        <form onSubmit={save} className="form-grid provider-form">
          <label><span>{t('name')}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label><span>{t('type')}</span><select value={form.type} onChange={(event) => changeType(event.target.value)}>{Object.keys(presets).map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label><span>{t('model')}</span><input value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} required autoComplete="off" /></label>
          <label><span>{t('baseUrl')}</span><input inputMode="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder={presets[form.type]?.baseUrl || 'https://…'} /></label>
          <label className="span-2"><span>{t('apiKey')}</span><input type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={editingId ? (language === 'ar' ? 'اتركه فارغًا للاحتفاظ بالمفتاح الحالي' : 'Leave blank to keep the current key') : ''} required={!editingId} /></label>
          <div className="form-actions span-2"><button type="button" className="secondary" onClick={() => { void testDraft(); }} disabled={busy !== null || !form.defaultModel.trim()}><SpinnerLabel active={busy === 'test'} activeText={t('testing')} idleText={t('testConnection')} /></button><button type="submit" disabled={busy !== null}><SpinnerLabel active={busy === 'save'} activeText={t('saving')} idleText={editingId ? t('save') : t('addProvider')} /></button></div>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading"><div><h2>{t('configuredProviders')}</h2><p>{providers.length}</p></div><button type="button" className="ghost" onClick={() => { void load(); }}>{t('refresh')}</button></div>
        {providers.length === 0 ? <EmptyState title={t('noProviders')} /> : <div className="resource-list">{providers.map((provider) => (
          <article className="resource-card" key={provider.id}>
            <div className="resource-main"><div className="resource-title"><strong>{provider.name}</strong><StatusBadge status={provider.validation_status} t={t} /></div><p>{provider.type} · {provider.default_model}</p><small>{provider.base_url || 'Default endpoint'}</small>{provider.validation_error_code && <code>{provider.validation_error_code}</code>}</div>
            <div className="resource-actions"><button type="button" className="secondary" onClick={() => { void testSaved(provider.id); }} disabled={busy !== null}><SpinnerLabel active={busy === `test-${provider.id}`} activeText={t('testing')} idleText={t('testConnection')} /></button><button type="button" className="ghost" onClick={() => edit(provider)}>{t('edit')}</button><button type="button" className="danger ghost" onClick={() => { void remove(provider.id); }} disabled={busy !== null}>{t('delete')}</button></div>
          </article>
        ))}</div>}
      </section>
    </div>
  );
}
