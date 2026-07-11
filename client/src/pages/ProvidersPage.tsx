import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, Notice, PageHeader, SpinnerLabel, StatusBadge } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { DiscoveredModel, ModelDiscoveryResult, ProviderCatalogEntry, ProviderDiagnostic, ProviderSummary } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type ProviderForm = { name: string; type: string; defaultModel: string; baseUrl: string; apiKey: string };
type ProviderTestResponse = { success: boolean; diagnostic: ProviderDiagnostic };
type ProviderSaveResponse = { provider: ProviderSummary };
type NoticeState = { tone: 'success' | 'error' | 'info' | 'warning'; text: string };

const fallbackCapabilities = { modelDiscovery: null, streaming: null, tools: null, vision: null, embeddings: null } as const;
const fallbackCatalog: ProviderCatalogEntry[] = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai-chat', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', capabilities: { modelDiscovery: true, streaming: true, tools: true, vision: true, embeddings: true }, baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['gpt-4.1-mini'] },
  { id: 'openrouter', label: 'OpenRouter', protocol: 'openai-chat', adapter: 'openai-compatible', defaultBaseUrl: 'https://openrouter.ai/api/v1', capabilities: { ...fallbackCapabilities, modelDiscovery: true }, baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['openai/gpt-4.1-mini'] },
  { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic-messages', adapter: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', capabilities: { modelDiscovery: true, streaming: true, tools: true, vision: true, embeddings: false }, baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['claude-sonnet-4-5'] },
  { id: 'gemini', label: 'Google Gemini', protocol: 'gemini-generate-content', adapter: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', capabilities: { modelDiscovery: true, streaming: true, tools: true, vision: true, embeddings: true }, baseUrlRequired: false, apiKeyRequired: true, modelExamples: ['gemini-2.5-flash'] },
  { id: 'custom', label: 'Custom OpenAI-compatible', protocol: 'openai-chat', adapter: 'openai-compatible', defaultBaseUrl: null, capabilities: fallbackCapabilities, baseUrlRequired: true, apiKeyRequired: true, modelExamples: [] }
];

function emptyForm(catalog: readonly ProviderCatalogEntry[]): ProviderForm {
  const selected = catalog.find((entry) => entry.id === 'openrouter') ?? catalog[0] ?? fallbackCatalog[0]!;
  return { name: '', type: selected.id, defaultModel: selected.modelExamples[0] ?? '', baseUrl: selected.defaultBaseUrl ?? '', apiKey: '' };
}

function triState(value: boolean | null, language: Language): string {
  if (value === true) return language === 'ar' ? 'نعم' : 'Yes';
  if (value === false) return language === 'ar' ? 'لا' : 'No';
  return language === 'ar' ? 'غير معروف' : 'Unknown';
}

function statusTone(diagnostic: ProviderDiagnostic): 'success' | 'warning' | 'error' | 'info' {
  if (diagnostic.success) return 'success';
  if (diagnostic.retryable) return 'warning';
  if (['invalid_api_key', 'forbidden', 'invalid_base_url', 'unsupported_protocol', 'invalid_request'].includes(diagnostic.status)) return 'error';
  return 'info';
}

function DiagnosticCard({ diagnostic, language }: { diagnostic: ProviderDiagnostic; language: Language }) {
  const message = language === 'ar' ? diagnostic.userMessageAr : diagnostic.userMessageEn;
  return <section className={`provider-diagnostic ${diagnostic.success ? 'ok' : diagnostic.retryable ? 'warning' : 'failed'}`} aria-live="polite">
    <div className="diagnostic-heading">
      <div><span className="eyebrow">Provider diagnostic</span><h3>{language === 'ar' ? 'نتيجة الفحص متعدد المراحل' : 'Multi-stage diagnostic result'}</h3></div>
      <span className={`diagnostic-signal ${diagnostic.success ? 'available' : diagnostic.retryable ? 'limited' : 'unavailable'}`}>{diagnostic.status}</span>
    </div>
    <p className="diagnostic-message">{message}</p>
    <div className="diagnostic-grid">
      <div><small>{language === 'ar' ? 'الوصول إلى المزود' : 'Provider reachable'}</small><strong>{triState(diagnostic.providerReachable, language)}</strong></div>
      <div><small>{language === 'ar' ? 'صلاحية المفتاح' : 'Key valid'}</small><strong>{triState(diagnostic.keyValid, language)}</strong></div>
      <div><small>{language === 'ar' ? 'توفر النموذج' : 'Model available'}</small><strong>{triState(diagnostic.modelAvailable, language)}</strong></div>
      <div><small>HTTP</small><strong>{diagnostic.httpStatus ?? '—'}</strong></div>
      <div><small>{language === 'ar' ? 'قابل لإعادة المحاولة' : 'Retryable'}</small><strong>{diagnostic.retryable ? (language === 'ar' ? 'نعم' : 'Yes') : (language === 'ar' ? 'لا' : 'No')}</strong></div>
      <div><small>{language === 'ar' ? 'زمن الاستجابة' : 'Latency'}</small><strong>{diagnostic.latencyMs === undefined ? '—' : `${diagnostic.latencyMs} ms`}</strong></div>
      <div><small>{language === 'ar' ? 'النموذج المختبر' : 'Tested model'}</small><strong>{diagnostic.testedModel ?? '—'}</strong></div>
      <div><small>{language === 'ar' ? 'اكتشاف النماذج' : 'Model discovery'}</small><strong>{diagnostic.discovery?.status ?? '—'}</strong></div>
      <div><small>{language === 'ar' ? 'عدد النماذج' : 'Models found'}</small><strong>{diagnostic.discovery?.models.length ?? '—'}</strong></div>
    </div>
    <dl className="definition-list diagnostic-details">
      <dt>{language === 'ar' ? 'المسار المختبر' : 'Tested endpoint'}</dt><dd>{diagnostic.testedEndpoint ?? '—'}</dd>
      <dt>{language === 'ar' ? 'رمز المزود' : 'Provider code'}</dt><dd>{diagnostic.providerCode ?? '—'}</dd>
      <dt>Request ID</dt><dd>{diagnostic.requestId ?? '—'}</dd>
      <dt>Provider Request ID</dt><dd>{diagnostic.upstreamRequestId ?? '—'}</dd>
      <dt>{language === 'ar' ? 'السبب المنقح' : 'Redacted reason'}</dt><dd>{diagnostic.message || '—'}</dd>
    </dl>
  </section>;
}

export function ProvidersPage({ request, t, language }: { request: Request; t: T; language: Language }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>(fallbackCatalog);
  const [form, setForm] = useState<ProviderForm>(() => emptyForm(fallbackCatalog));
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [diagnostic, setDiagnostic] = useState<ProviderDiagnostic | null>(null);
  const [normalizedPreview, setNormalizedPreview] = useState<{ normalizedBaseUrl: string; resolvedChatUrl: string; resolvedModelsUrls: string[] } | null>(null);

  const definition = useMemo(() => catalog.find((entry) => entry.id === form.type) ?? fallbackCatalog.at(-1)!, [catalog, form.type]);
  const canUseDraftCredentials = !definition.apiKeyRequired || Boolean(form.apiKey.trim()) || Boolean(editingId);

  const load = useCallback(async () => {
    try {
      const [providerResponse, catalogResponse] = await Promise.all([
        request<{ providers: ProviderSummary[] }>('/api/providers'),
        request<{ providers: ProviderCatalogEntry[] }>('/api/provider-catalog')
      ]);
      setProviders(providerResponse.providers);
      if (catalogResponse.providers.length) setCatalog(catalogResponse.providers);
    } catch (error) {
      setNotice({ tone: 'error', text: formatError(error, language) });
    }
  }, [language, request]);

  useEffect(() => { void load(); }, [load]);

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm(catalog));
    setModels([]);
    setDiagnostic(null);
    setNormalizedPreview(null);
  };

  const payload = () => ({
    name: form.name.trim(),
    type: form.type,
    defaultModel: form.defaultModel.trim(),
    ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {})
  });

  const normalizeUrl = async () => {
    if (!form.baseUrl.trim()) { setNormalizedPreview(null); return; }
    try {
      const result = await request<{ normalizedBaseUrl: string; resolvedChatUrl: string; resolvedModelsUrls: string[] }>('/api/providers/normalize-url', {
        method: 'POST', body: JSON.stringify({ type: form.type, baseUrl: form.baseUrl.trim(), ...(form.defaultModel.trim() ? { model: form.defaultModel.trim() } : {}) })
      });
      setNormalizedPreview(result);
    } catch (error) {
      setNormalizedPreview(null);
      setNotice({ tone: 'error', text: formatError(error, language) });
    }
  };

  const discover = async (saved?: ProviderSummary) => {
    setBusy(saved ? `models-${saved.id}` : 'models');
    setNotice(null);
    try {
      const result = saved
        ? await request<ModelDiscoveryResult>(`/api/providers/${saved.id}/models`)
        : await request<ModelDiscoveryResult>('/api/providers/discover-models', {
          method: 'POST',
          body: JSON.stringify({ type: form.type, apiKey: form.apiKey.trim(), ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}) })
        });
      setModels(result.models);
      if (saved) {
        setEditingId(saved.id);
        setForm({ name: saved.name, type: saved.type, defaultModel: saved.default_model, baseUrl: saved.raw_base_url ?? saved.base_url ?? '', apiKey: '' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      setNotice({
        tone: result.success ? 'success' : result.status === 'model_discovery_unsupported' ? 'warning' : 'error',
        text: result.success
          ? (language === 'ar' ? `اكتُشف ${result.models.length} نموذجًا. اختر نموذجًا ولا يتم تغييره تلقائيًا.` : `Discovered ${result.models.length} models. Choose one; it is never changed automatically.`)
          : result.status === 'model_discovery_unsupported'
            ? (language === 'ar' ? 'اكتشاف النماذج غير مدعوم، لكن يمكنك إدخال النموذج يدويًا ثم فحصه.' : 'Model discovery is unsupported; enter a model manually and test it.')
            : result.message
      });
    } catch (error) {
      setNotice({ tone: 'error', text: formatError(error, language) });
    } finally {
      setBusy(null);
    }
  };

  const testDraft = async () => {
    if (!form.defaultModel.trim()) { setNotice({ tone: 'error', text: language === 'ar' ? 'أدخل النموذج المراد اختباره.' : 'Enter the model to test.' }); return; }
    setBusy('test');
    setDiagnostic(null);
    setNotice(null);
    try {
      const result = await request<ProviderTestResponse>('/api/providers/test', {
        method: 'POST',
        body: JSON.stringify({ type: form.type, model: form.defaultModel.trim(), apiKey: form.apiKey.trim(), ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}) })
      });
      setDiagnostic(result.diagnostic);
      setNotice({ tone: statusTone(result.diagnostic), text: language === 'ar' ? result.diagnostic.userMessageAr : result.diagnostic.userMessageEn });
    } catch (error) {
      setNotice({ tone: 'error', text: formatError(error, language) });
    } finally { setBusy(null); }
  };

  const saveDraft = async (): Promise<string | null> => {
    setBusy('save-draft');
    setNotice(null);
    try {
      if (editingId) {
        await request(`/api/providers/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload()) });
        setNotice({ tone: 'success', text: language === 'ar' ? 'حُفظت التعديلات كمسودة. أعد الفحص لتفعيل المزود.' : 'Changes saved as a draft. Retest to enable the provider.' });
        await load();
        return editingId;
      }
      const response = await request<ProviderSaveResponse>('/api/providers', { method: 'POST', body: JSON.stringify(payload()) });
      setEditingId(response.provider.id);
      setForm((current) => ({ ...current, apiKey: '' }));
      setNotice({ tone: 'success', text: language === 'ar' ? 'حُفظ المزود كمسودة دون اعتباره جاهزًا.' : 'Provider saved as a draft and is not ready yet.' });
      await load();
      return response.provider.id;
    } catch (error) {
      setNotice({ tone: 'error', text: formatError(error, language) });
      return null;
    } finally { setBusy(null); }
  };

  const retest = async (id: string) => {
    setBusy(`retest-${id}`);
    setDiagnostic(null);
    setNotice(null);
    try {
      const result = await request<ProviderTestResponse & { status: string; is_ready: boolean }>(`/api/providers/${id}/retest`, { method: 'POST', body: '{}' });
      setDiagnostic(result.diagnostic);
      setNotice({ tone: statusTone(result.diagnostic), text: language === 'ar' ? result.diagnostic.userMessageAr : result.diagnostic.userMessageEn });
      await load();
    } catch (error) {
      setNotice({ tone: 'error', text: formatError(error, language) });
    } finally { setBusy(null); }
  };

  const saveAndTest = async (event: React.FormEvent) => {
    event.preventDefault();
    const id = await saveDraft();
    if (id) await retest(id);
  };

  const edit = (provider: ProviderSummary) => {
    setEditingId(provider.id);
    setForm({ name: provider.name, type: provider.type, defaultModel: provider.default_model, baseUrl: provider.raw_base_url ?? provider.base_url ?? '', apiKey: '' });
    setModels(provider.discovered_models ?? []);
    setDiagnostic(null);
    setNormalizedPreview(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (id: string) => {
    if (!window.confirm(language === 'ar' ? 'تعطيل المزود وفصله عن المحادثات؟' : 'Disable this provider and detach it from chats?')) return;
    setBusy(`delete-${id}`);
    try {
      await request(`/api/providers/${id}`, { method: 'DELETE' });
      if (editingId === id) reset();
      await load();
    } catch (error) { setNotice({ tone: 'error', text: formatError(error, language) }); }
    finally { setBusy(null); }
  };

  const changeType = (type: string) => {
    const next = catalog.find((entry) => entry.id === type);
    setForm((current) => ({ ...current, type, baseUrl: next?.defaultBaseUrl ?? '', defaultModel: next?.modelExamples[0] ?? '' }));
    setModels([]);
    setNormalizedPreview(null);
    setDiagnostic(null);
  };

  return <div className="page-stack providers-page">
    <PageHeader eyebrow={t('settings')} title={t('providers')} description={language === 'ar' ? 'Registry موحد مع Adapters مستقلة لـOpenAI-compatible وAnthropic وGemini، واكتشاف نماذج وفحص inference حقيقي وتشخيص لا يخلط 503 مع المفتاح الخاطئ.' : 'A unified registry with separate OpenAI-compatible, Anthropic, and Gemini adapters, model discovery, real inference probes, and diagnostics that never misclassify 503 as a bad key.'} />
    {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}><pre>{notice.text}</pre></Notice>}

    <section className="panel provider-editor">
      <div className="section-heading"><div><h2>{editingId ? t('edit') : t('addProvider')}</h2><p>{language === 'ar' ? 'الحفظ كمسودة لا يفعّل المزود. يصبح جاهزًا فقط بعد نجاح inference حقيقي للنموذج الذي اخترته.' : 'Saving a draft does not enable the provider. It becomes ready only after real inference succeeds for the model you selected.'}</p></div>{editingId && <button type="button" className="ghost" onClick={reset}>{t('cancel')}</button>}</div>
      <form className="form-grid provider-form" onSubmit={saveAndTest}>
        <label><span>{t('name')}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder={definition.label} /></label>
        <label><span>{t('type')}</span><select value={form.type} onChange={(event) => changeType(event.target.value)}>{catalog.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select></label>
        <label><span>{t('baseUrl')}</span><input inputMode="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} onBlur={() => { void normalizeUrl(); }} required={definition.baseUrlRequired} placeholder="https://api.example.com/v1" /><small>{form.type === 'custom' ? (language === 'ar' ? 'أدخل جذر API. يمكن أن ينتهي بـ /v1 أو بمسار مخصص مثل /openai/v1، ولا تضع /chat/completions.' : 'Enter the API root. It may end in /v1 or a custom path such as /openai/v1; do not append /chat/completions.') : (language === 'ar' ? 'القيمة الافتراضية قابلة للتعديل عند الحاجة.' : 'The default can be overridden when required.')}</small></label>
        <label><span>{t('apiKey')}</span><input type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} required={!editingId && definition.apiKeyRequired} placeholder={editingId ? (language === 'ar' ? 'اتركه فارغًا للاحتفاظ بالمفتاح المشفر الحالي' : 'Leave blank to keep the encrypted key') : ''} /></label>
        <label className="span-2"><span>{language === 'ar' ? 'النموذج — قابل للبحث أو الإدخال اليدوي' : 'Model — searchable or manual'}</span><input list="provider-model-options" value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} required autoComplete="off" /><datalist id="provider-model-options">{models.map((model) => <option value={model.id} key={model.id}>{model.name ?? model.id}</option>)}</datalist><small>{language === 'ar' ? 'لا يتم اختيار أو تغيير النموذج تلقائيًا.' : 'The model is never selected or changed automatically.'}</small></label>
        {normalizedPreview && <div className="span-2 normalized-preview"><strong>{language === 'ar' ? 'تطبيع الرابط' : 'URL normalization'}</strong><code>{normalizedPreview.normalizedBaseUrl}</code><small>Chat: {normalizedPreview.resolvedChatUrl}</small><small>Models: {normalizedPreview.resolvedModelsUrls.join(' · ') || 'unsupported'}</small></div>}
        <div className="form-actions span-2 provider-actions">
          <button type="button" className="ghost" onClick={() => { void discover(); }} disabled={busy !== null || !canUseDraftCredentials}><SpinnerLabel active={busy === 'models'} activeText={language === 'ar' ? 'جارٍ الاكتشاف…' : 'Discovering…'} idleText={language === 'ar' ? 'اكتشاف النماذج' : 'Discover models'} /></button>
          <button type="button" className="secondary" onClick={() => { void testDraft(); }} disabled={busy !== null || !canUseDraftCredentials || !form.defaultModel.trim()}><SpinnerLabel active={busy === 'test'} activeText={t('testing')} idleText={language === 'ar' ? 'فحص دون حفظ' : 'Test without saving'} /></button>
          <button type="button" className="ghost" onClick={() => { void saveDraft(); }} disabled={busy !== null}><SpinnerLabel active={busy === 'save-draft'} activeText={t('saving')} idleText={language === 'ar' ? 'حفظ كمسودة' : 'Save draft'} /></button>
          <button type="submit" disabled={busy !== null}><SpinnerLabel active={busy?.startsWith('retest-') === true || busy === 'save-draft'} activeText={language === 'ar' ? 'جارٍ الحفظ والفحص…' : 'Saving and testing…'} idleText={language === 'ar' ? 'حفظ وفحص' : 'Save & test'} /></button>
        </div>
      </form>
      <div className="provider-capability-note"><strong>{definition.protocol}</strong><span>{definition.label}</span><code>models:{triState(definition.capabilities.modelDiscovery, language)} · stream:{triState(definition.capabilities.streaming, language)} · tools:{triState(definition.capabilities.tools, language)} · vision:{triState(definition.capabilities.vision, language)}</code></div>
    </section>

    {diagnostic && <DiagnosticCard diagnostic={diagnostic} language={language} />}

    <section className="panel">
      <div className="section-heading"><div><h2>{t('configuredProviders')}</h2><p>{language === 'ar' ? `${providers.filter((provider) => provider.is_ready || provider.validation_status === 'ready').length} جاهز من ${providers.length}` : `${providers.filter((provider) => provider.is_ready || provider.validation_status === 'ready').length} ready of ${providers.length}`}</p></div><button type="button" className="ghost" onClick={() => { void load(); }}>{t('refresh')}</button></div>
      {providers.length === 0 ? <EmptyState title={t('noProviders')} /> : <div className="resource-list provider-list">{providers.map((provider) => <article className={`resource-card provider-resource ${provider.validation_status}`} key={provider.id}>
        <div className="resource-main">
          <div className="resource-title"><strong>{provider.name}</strong><StatusBadge status={provider.validation_status} t={t} /></div>
          <p>{provider.type} · {provider.protocol ?? '—'} · {provider.default_model}</p>
          <small>{provider.normalized_base_url ?? provider.base_url ?? '—'}</small>
          {provider.validation_error_code && <code>{provider.validation_error_code}</code>}
          {provider.last_check_message && <small>{provider.last_check_message}</small>}
          <small>{language === 'ar' ? 'زمن آخر فحص: ' : 'Last latency: '}{provider.last_latency_ms === null || provider.last_latency_ms === undefined ? '—' : `${provider.last_latency_ms} ms`}</small>
        </div>
        <div className="resource-actions">
          <button type="button" className="ghost" onClick={() => { void discover(provider); }} disabled={busy !== null}><SpinnerLabel active={busy === `models-${provider.id}`} activeText={language === 'ar' ? 'اكتشاف…' : 'Discovering…'} idleText={language === 'ar' ? 'اكتشاف النماذج' : 'Discover models'} /></button>
          <button type="button" className="secondary" onClick={() => { void retest(provider.id); }} disabled={busy !== null}><SpinnerLabel active={busy === `retest-${provider.id}`} activeText={t('testing')} idleText={language === 'ar' ? 'إعادة الفحص' : 'Retest'} /></button>
          <button type="button" className="ghost" onClick={() => edit(provider)}>{language === 'ar' ? 'اختيار نموذج آخر / تعديل' : 'Choose another model / Edit'}</button>
          <button type="button" className="danger ghost" onClick={() => { void remove(provider.id); }} disabled={busy !== null}>{t('delete')}</button>
        </div>
      </article>)}</div>}
    </section>
  </div>;
}
