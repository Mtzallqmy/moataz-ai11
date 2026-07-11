import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, Notice, PageHeader, SpinnerLabel, StatusBadge } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { ProviderCatalogEntry, ProviderSummary } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type ProviderForm = { name: string; type: string; defaultModel: string; baseUrl: string; apiKey: string };

const fallbackCatalog: ProviderCatalogEntry[] = [
  { id: 'openai', label: 'OpenAI', adapter: 'openai-compatible', defaultBaseUrl: null, baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['gpt-4.1-mini'] },
  { id: 'openrouter', label: 'OpenRouter', adapter: 'openai-compatible', defaultBaseUrl: 'https://openrouter.ai/api/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['openai/gpt-4.1-mini'] },
  { id: 'nvidia', label: 'NVIDIA NIM', adapter: 'openai-compatible', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['meta/llama-3.1-70b-instruct'] },
  { id: 'huggingface', label: 'Hugging Face Router', adapter: 'openai-compatible', defaultBaseUrl: 'https://router.huggingface.co/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['openai/gpt-oss-120b:cerebras'] },
  { id: 'custom', label: 'Custom OpenAI-compatible', adapter: 'openai-compatible', defaultBaseUrl: null, baseUrlRequired: true, apiKeyRequired: true, modelExamples: [] }
];

function emptyForm(catalog: readonly ProviderCatalogEntry[]): ProviderForm {
  const initial = catalog.find((entry) => entry.id === 'openrouter') ?? catalog[0] ?? fallbackCatalog[0]!;
  return {
    name: '',
    type: initial.id,
    defaultModel: initial.modelExamples[0] ?? '',
    baseUrl: initial.defaultBaseUrl ?? '',
    apiKey: ''
  };
}

export function ProvidersPage({ request, t, language }: { request: Request; t: T; language: Language }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>(fallbackCatalog);
  const [form, setForm] = useState<ProviderForm>(() => emptyForm(fallbackCatalog));
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'models' | string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  const selectedDefinition = useMemo(
    () => catalog.find((entry) => entry.id === form.type) ?? {
      id: form.type, label: form.type, adapter: 'openai-compatible' as const, defaultBaseUrl: null,
      baseUrlRequired: true, apiKeyRequired: true, modelExamples: []
    },
    [catalog, form.type]
  );

  const load = useCallback(async () => {
    try {
      const [providerResponse, catalogResponse] = await Promise.all([
        request<{ providers: ProviderSummary[] }>('/api/providers'),
        request<{ providers: ProviderCatalogEntry[] }>('/api/provider-catalog')
      ]);
      setProviders(providerResponse.providers);
      if (catalogResponse.providers.length > 0) setCatalog(catalogResponse.providers);
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    }
  }, [language, request]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (modelSuggestions.length === 0) setModelSuggestions([...selectedDefinition.modelExamples]);
  }, [modelSuggestions.length, selectedDefinition.modelExamples]);

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm(catalog));
    setModelSuggestions([]);
  };

  const payload = () => ({
    name: form.name.trim(),
    type: form.type,
    defaultModel: form.defaultModel.trim(),
    ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {})
  });

  const canCallDraft = !selectedDefinition.apiKeyRequired || Boolean(form.apiKey.trim());

  const testDraft = async () => {
    if (!canCallDraft) {
      setNotice({ tone: 'error', text: language === 'ar' ? 'أدخل مفتاح API لاختبار الاتصال.' : 'Enter an API key to test the connection.' });
      return;
    }
    if (!form.defaultModel.trim()) {
      setNotice({ tone: 'error', text: language === 'ar' ? 'أدخل اسم النموذج.' : 'Enter a model name.' });
      return;
    }
    setBusy('test');
    setNotice(null);
    try {
      const response = await request<{ responsePreview?: string }>('/api/providers/test', {
        method: 'POST',
        body: JSON.stringify({
          type: form.type,
          model: form.defaultModel.trim(),
          apiKey: form.apiKey.trim(),
          ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {})
        })
      });
      setNotice({ tone: 'success', text: `${t('connectionSuccessful')}${response.responsePreview ? ` — ${response.responsePreview}` : ''}` });
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const discoverDraftModels = async () => {
    if (!canCallDraft) {
      setNotice({ tone: 'error', text: language === 'ar' ? 'أدخل مفتاح API أولًا.' : 'Enter the API key first.' });
      return;
    }
    setBusy('models');
    setNotice(null);
    try {
      const response = await request<{ supported: boolean; models: string[] }>('/api/providers/models', {
        method: 'POST',
        body: JSON.stringify({
          type: form.type,
          apiKey: form.apiKey.trim(),
          ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {})
        })
      });
      const models = response.models.length > 0 ? response.models : [...selectedDefinition.modelExamples];
      setModelSuggestions(models);
      setNotice({
        tone: response.supported ? 'success' : 'info',
        text: response.supported
          ? (language === 'ar' ? `تم تحميل ${models.length} نموذجًا.` : `Loaded ${models.length} models.`)
          : (language === 'ar' ? 'هذا المزود لا يوفر مسارًا عامًا لقائمة النماذج؛ استخدم أحد الأمثلة أو أدخل الاسم يدويًا.' : 'This provider does not expose a public model-list endpoint; use an example or enter the model manually.')
      });
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const discoverSavedModels = async (provider: ProviderSummary) => {
    setBusy(`models-${provider.id}`);
    setNotice(null);
    try {
      const response = await request<{ supported: boolean; models: string[] }>(`/api/providers/${provider.id}/models`);
      setEditingId(provider.id);
      setForm({ name: provider.name, type: provider.type, defaultModel: provider.default_model, baseUrl: provider.base_url ?? '', apiKey: '' });
      setModelSuggestions(response.models);
      setNotice({ tone: 'success', text: language === 'ar' ? `تم تحميل ${response.models.length} نموذجًا.` : `Loaded ${response.models.length} models.` });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingId && selectedDefinition.apiKeyRequired && !form.apiKey.trim()) return;
    setBusy('save');
    setNotice(null);
    try {
      if (editingId) {
        await request(`/api/providers/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload()) });
      } else {
        await request('/api/providers', { method: 'POST', body: JSON.stringify(payload()) });
      }
      reset();
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
    setModelSuggestions(catalog.find((entry) => entry.id === provider.type)?.modelExamples.slice() ?? []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (id: string) => {
    if (!window.confirm(language === 'ar' ? 'حذف المزوّد وفصله عن المحادثات؟' : 'Delete this provider and detach it from chats?')) return;
    setBusy(`delete-${id}`);
    try {
      await request(`/api/providers/${id}`, { method: 'DELETE' });
      if (editingId === id) reset();
      await load();
    } catch (caught) {
      setNotice({ tone: 'error', text: formatError(caught, language) });
    } finally {
      setBusy(null);
    }
  };

  const changeType = (type: string) => {
    const definition = catalog.find((entry) => entry.id === type);
    setForm((current) => ({
      ...current,
      type,
      baseUrl: definition?.defaultBaseUrl ?? '',
      defaultModel: definition?.modelExamples[0] ?? ''
    }));
    setModelSuggestions(definition?.modelExamples.slice() ?? []);
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow={t('settings')} title={t('providers')} description={language === 'ar' ? 'مزوّدات أصلية وواجهات OpenAI-compatible، مع رابط جاهز قابل للتعديل واكتشاف للنماذج واختبار حقيقي قبل الدردشة.' : 'Native and OpenAI-compatible providers with editable presets, model discovery, and real validation before chat.'} />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}><pre>{notice.text}</pre></Notice>}
      <section className="panel">
        <div className="section-heading"><div><h2>{editingId ? t('edit') : t('addProvider')}</h2><p>{language === 'ar' ? 'الحفظ لا يستهلك رصيدًا. يجب الضغط على اختبار الاتصال حتى تصبح الحالة «تم التحقق» وتعمل المحادثة.' : 'Saving does not consume credits. Test the provider so it becomes verified and usable in chat.'}</p></div>{editingId && <button type="button" className="ghost" onClick={reset}>{t('cancel')}</button>}</div>
        <form onSubmit={save} className="form-grid provider-form">
          <label><span>{t('name')}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label><span>{t('type')}</span><select value={form.type} onChange={(event) => changeType(event.target.value)}>{catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
          <label><span>{t('model')}</span><input list="provider-models" value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} required autoComplete="off" /><datalist id="provider-models">{modelSuggestions.map((model) => <option value={model} key={model} />)}</datalist></label>
          <label><span>{t('baseUrl')}</span><input inputMode="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} required={selectedDefinition.baseUrlRequired} placeholder={selectedDefinition.defaultBaseUrl ?? 'https://api.example.com/v1'} /><small>{language === 'ar' ? 'الرابط المقترح قابل للتعديل لأي API متوافق مع OpenAI.' : 'The preset can be overridden for any OpenAI-compatible API.'}</small></label>
          <label className="span-2"><span>{t('apiKey')}</span><input type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={editingId ? (language === 'ar' ? 'اتركه فارغًا للاحتفاظ بالمفتاح الحالي' : 'Leave blank to keep the current key') : selectedDefinition.apiKeyRequired ? '' : (language === 'ar' ? 'اختياري لهذا المزود' : 'Optional for this provider')} required={!editingId && selectedDefinition.apiKeyRequired} /></label>
          <div className="form-actions span-2 provider-actions">
            <button type="button" className="ghost" onClick={() => { void discoverDraftModels(); }} disabled={busy !== null || !canCallDraft}><SpinnerLabel active={busy === 'models'} activeText={language === 'ar' ? 'جارٍ تحميل النماذج…' : 'Loading models…'} idleText={language === 'ar' ? 'تحميل النماذج' : 'Load models'} /></button>
            <button type="button" className="secondary" onClick={() => { void testDraft(); }} disabled={busy !== null || !form.defaultModel.trim() || !canCallDraft}><SpinnerLabel active={busy === 'test'} activeText={t('testing')} idleText={t('testConnection')} /></button>
            <button type="submit" disabled={busy !== null}><SpinnerLabel active={busy === 'save'} activeText={t('saving')} idleText={editingId ? t('save') : t('addProvider')} /></button>
          </div>
        </form>
        <div className="provider-capability-note"><strong>{selectedDefinition.adapter}</strong><span>{selectedDefinition.label}</span>{selectedDefinition.modelExamples.length > 0 && <code>{selectedDefinition.modelExamples.join(' · ')}</code>}</div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><h2>{t('configuredProviders')}</h2><p>{providers.length}</p></div><button type="button" className="ghost" onClick={() => { void load(); }}>{t('refresh')}</button></div>
        {providers.length === 0 ? <EmptyState title={t('noProviders')} /> : <div className="resource-list">{providers.map((provider) => (
          <article className="resource-card" key={provider.id}>
            <div className="resource-main"><div className="resource-title"><strong>{provider.name}</strong><StatusBadge status={provider.validation_status} t={t} /></div><p>{provider.type} · {provider.default_model}</p><small>{provider.base_url || 'Default endpoint'}</small>{provider.validation_error_code && <code>{provider.validation_error_code}</code>}</div>
            <div className="resource-actions"><button type="button" className="ghost" onClick={() => { void discoverSavedModels(provider); }} disabled={busy !== null}><SpinnerLabel active={busy === `models-${provider.id}`} activeText={language === 'ar' ? 'تحميل…' : 'Loading…'} idleText={language === 'ar' ? 'النماذج' : 'Models'} /></button><button type="button" className="secondary" onClick={() => { void testSaved(provider.id); }} disabled={busy !== null}><SpinnerLabel active={busy === `test-${provider.id}`} activeText={t('testing')} idleText={t('testConnection')} /></button><button type="button" className="ghost" onClick={() => edit(provider)}>{t('edit')}</button><button type="button" className="danger ghost" onClick={() => { void remove(provider.id); }} disabled={busy !== null}>{t('delete')}</button></div>
          </article>
        ))}</div>}
      </section>
    </div>
  );
}
