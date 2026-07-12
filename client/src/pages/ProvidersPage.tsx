import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, Notice, PageHeader, SpinnerLabel, StatusBadge } from '../components/ui';
import { errorDetails, formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type {
  ProviderCatalogEntry,
  ProviderDiagnostic,
  ProviderModelDiscovery,
  ProviderProtocol,
  ProviderSummary
} from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;

type ProviderForm = {
  name: string;
  type: string;
  protocol: ProviderProtocol;
  defaultModel: string;
  baseUrl: string;
  apiKey: string;
  customHeaders: string;
  streamingEnabled: boolean;
};

type ProviderTestResponse = {
  responsePreview?: string;
  diagnostic?: ProviderDiagnostic;
  discovery?: ProviderModelDiscovery;
  model?: string;
  models?: string[];
};

type ModelResponse = {
  supported: boolean;
  models: string[];
  modelsDetailed?: Array<{ id: string; name?: string }>;
  recommendedModel?: string | null;
  discovery?: ProviderModelDiscovery;
};

const fallbackCatalog: ProviderCatalogEntry[] = [
  { id: 'openai', label: 'OpenAI', adapter: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: [] },
  { id: 'openrouter', label: 'OpenRouter', adapter: 'openai-compatible', defaultBaseUrl: 'https://openrouter.ai/api/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: [] },
  { id: 'nararouter', label: 'NaraRouter', adapter: 'openai-compatible', defaultBaseUrl: 'https://router.bynara.id/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: [] },
  { id: 'omniroute', label: 'OmniRoute Gateway', adapter: 'openai-compatible', defaultBaseUrl: null, baseUrlRequired: true, apiKeyRequired: true, modelExamples: ['auto', 'auto/coding', 'auto/fast', 'auto/cheap', 'auto/offline', 'auto/smart'] },
  { id: 'groq', label: 'Groq', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.groq.com/openai/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: [] },
  { id: 'together', label: 'Together AI', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.together.xyz/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: [] },
  { id: 'deepseek', label: 'DeepSeek', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.deepseek.com/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: [] },
  { id: 'mistral', label: 'Mistral', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.mistral.ai/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: [] },
  { id: 'xai', label: 'xAI', adapter: 'openai-compatible', defaultBaseUrl: 'https://api.x.ai/v1', baseUrlRequired: false, apiKeyRequired: true, modelExamples: [] },
  { id: 'anthropic', label: 'Anthropic', adapter: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', baseUrlRequired: false, apiKeyRequired: true, modelExamples: [] },
  { id: 'gemini', label: 'Google Gemini', adapter: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com', baseUrlRequired: false, apiKeyRequired: true, modelExamples: [] },
  { id: 'ollama', label: 'Ollama', adapter: 'openai-compatible', defaultBaseUrl: 'http://127.0.0.1:11434/v1', baseUrlRequired: true, apiKeyRequired: false, modelExamples: [] },
  { id: 'lmstudio', label: 'LM Studio', adapter: 'openai-compatible', defaultBaseUrl: 'http://127.0.0.1:1234/v1', baseUrlRequired: true, apiKeyRequired: false, modelExamples: [] },
  { id: 'vllm', label: 'vLLM', adapter: 'openai-compatible', defaultBaseUrl: 'http://127.0.0.1:8000/v1', baseUrlRequired: true, apiKeyRequired: false, modelExamples: [] },
  { id: 'custom', label: 'Custom OpenAI-compatible', adapter: 'openai-compatible', defaultBaseUrl: null, baseUrlRequired: true, apiKeyRequired: true, modelExamples: [] }
];

function initialDefinition(catalog: readonly ProviderCatalogEntry[]): ProviderCatalogEntry {
  return catalog.find((entry) => entry.id === 'openrouter') ?? catalog[0] ?? fallbackCatalog[0]!;
}

function emptyForm(catalog: readonly ProviderCatalogEntry[]): ProviderForm {
  const initial = initialDefinition(catalog);
  return {
    name: '',
    type: initial.id,
    protocol: initial.adapter,
    defaultModel: '',
    baseUrl: initial.defaultBaseUrl ?? '',
    apiKey: '',
    customHeaders: '',
    streamingEnabled: true
  };
}

function parseCustomHeaders(value: string): Record<string, string> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Custom headers must be a JSON object.');
  }
  const result: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue !== 'string') throw new Error(`Custom header ${name} must be a string.`);
    result[name] = headerValue;
  }
  return result;
}

function stageLabel(stage: ProviderDiagnostic['stage'], language: Language): string {
  const labels = language === 'ar'
    ? { configuration: 'الإعداد', authentication: 'المصادقة', model_discovery: 'اكتشاف النماذج', inference: 'الاستدلال', streaming: 'البث' }
    : { configuration: 'Configuration', authentication: 'Authentication', model_discovery: 'Model discovery', inference: 'Inference', streaming: 'Streaming' };
  return labels[stage];
}

function DiagnosticCard({ diagnostic, language }: { diagnostic: ProviderDiagnostic; language: Language }) {
  const safeTechnical = [
    diagnostic.technicalMessage,
    diagnostic.providerCode ? `providerCode=${diagnostic.providerCode}` : undefined,
    diagnostic.requestId ? `requestId=${diagnostic.requestId}` : undefined,
    diagnostic.upstreamRequestId ? `upstreamRequestId=${diagnostic.upstreamRequestId}` : undefined,
    diagnostic.testedEndpoint ? `endpoint=${diagnostic.testedEndpoint}` : undefined,
    diagnostic.testedModel ? `model=${diagnostic.testedModel}` : undefined
  ].filter(Boolean).join('\n');

  return <section className={`provider-diagnostic ${diagnostic.ok ? 'ok' : 'failed'}`} aria-live="polite">
    <div className="diagnostic-heading">
      <div><span className="eyebrow">Provider diagnostic</span><h3>{diagnostic.ok ? (language === 'ar' ? 'الاتصال يعمل' : 'Connection works') : (language === 'ar' ? 'فشل الفحص' : 'Diagnostic failed')}</h3></div>
      <span className={`status-badge ${diagnostic.ok ? 'verified' : 'failed'}`}>{stageLabel(diagnostic.stage, language)}</span>
    </div>
    <div className="diagnostic-grid">
      <div><small>HTTP</small><strong>{diagnostic.httpStatus ?? '—'}</strong></div>
      <div><small>{language === 'ar' ? 'نوع الخطأ' : 'Error type'}</small><strong>{diagnostic.errorType ?? diagnostic.status}</strong></div>
      <div><small>{language === 'ar' ? 'المفتاح' : 'API key'}</small><strong>{diagnostic.keyValid === true ? (language === 'ar' ? 'مقبول' : 'Accepted') : diagnostic.keyValid === false ? (language === 'ar' ? 'مرفوض' : 'Rejected') : (language === 'ar' ? 'غير محسوم' : 'Not determined')}</strong></div>
      <div><small>{language === 'ar' ? 'النموذج' : 'Model'}</small><strong>{diagnostic.testedModel ?? '—'}</strong></div>
      <div><small>{language === 'ar' ? 'إعادة المحاولة' : 'Retryable'}</small><strong>{diagnostic.retryable ? (language === 'ar' ? 'نعم' : 'Yes') : (language === 'ar' ? 'لا' : 'No')}</strong></div>
      <div><small>{language === 'ar' ? 'الزمن' : 'Latency'}</small><strong>{diagnostic.latencyMs === undefined ? '—' : `${diagnostic.latencyMs} ms`}</strong></div>
    </div>
    <p>{language === 'ar' ? diagnostic.userMessageAr : diagnostic.userMessageEn}</p>
    {diagnostic.discovery && <div className="probe-attempts">
      <strong>{language === 'ar' ? 'اكتشاف النماذج' : 'Model discovery'}</strong>
      <div className="probe-row"><span>{diagnostic.discovery.status === 'supported' ? '✓' : diagnostic.discovery.status === 'unsupported' ? '!' : '×'}</span><code>{diagnostic.discovery.method ?? '—'} · {diagnostic.discovery.models.length}</code><small>{diagnostic.discovery.message ?? diagnostic.discovery.status}</small></div>
    </div>}
    {safeTechnical && <details><summary>{language === 'ar' ? 'التفاصيل التقنية الآمنة' : 'Safe technical details'}</summary><pre>{safeTechnical}</pre><button type="button" className="ghost compact" onClick={() => { void navigator.clipboard.writeText(safeTechnical); }}>{language === 'ar' ? 'نسخ' : 'Copy'}</button></details>}
  </section>;
}

export function ProvidersPage({ request, t, language }: { request: Request; t: T; language: Language }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>(fallbackCatalog);
  const [form, setForm] = useState<ProviderForm>(() => emptyForm(fallbackCatalog));
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [diagnostic, setDiagnostic] = useState<ProviderDiagnostic | null>(null);

  const selectedDefinition = useMemo(() => catalog.find((entry) => entry.id === form.type) ?? {
    id: form.type,
    label: form.type,
    adapter: form.protocol,
    defaultBaseUrl: null,
    baseUrlRequired: true,
    apiKeyRequired: form.type !== 'ollama' && form.type !== 'lmstudio' && form.type !== 'vllm',
    modelExamples: []
  }, [catalog, form.protocol, form.type]);

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

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm(catalog));
    setModelSuggestions([]);
    setDiagnostic(null);
  };

  const payload = (includeBlankKey = false) => {
    const customHeaders = parseCustomHeaders(form.customHeaders);
    return {
      name: form.name.trim(),
      type: form.type,
      protocol: form.protocol,
      defaultModel: form.defaultModel.trim(),
      baseUrl: form.baseUrl.trim(),
      streamingEnabled: form.streamingEnabled,
      customHeaders,
      ...((includeBlankKey || form.apiKey.length > 0) ? { apiKey: form.apiKey } : {})
    };
  };

  const canCallDraft = (!selectedDefinition.apiKeyRequired || Boolean(form.apiKey.trim())) && Boolean(form.defaultModel.trim() || form.baseUrl.trim());

  const recordFailure = (caught: unknown) => {
    setNotice({ tone: 'error', text: formatError(caught, language) });
    setDiagnostic(errorDetails(caught)?.diagnostic ?? null);
  };

  const applyModels = (response: ModelResponse | ProviderTestResponse) => {
    const models = response.models ?? response.discovery?.models.map((model) => model.id) ?? [];
    setModelSuggestions(models);
    if ('recommendedModel' in response && response.recommendedModel) {
      setForm((current) => ({ ...current, defaultModel: response.recommendedModel! }));
    }
  };

  const discoverDraftModels = async () => {
    setBusy('models'); setNotice(null); setDiagnostic(null);
    try {
      const body = payload(true);
      const response = await request<ModelResponse>('/api/providers/models', { method: 'POST', body: JSON.stringify(body) });
      applyModels(response);
      setNotice({
        tone: response.supported ? 'success' : 'info',
        text: response.supported
          ? (language === 'ar' ? `تم اكتشاف ${response.models.length} نموذجًا. اختر Model ID الفعلي ثم نفّذ اختبار الاتصال.` : `Discovered ${response.models.length} models. Select an actual model ID, then test the connection.`)
          : (language === 'ar' ? 'مسار النماذج غير مدعوم. أدخل Model ID يدويًا ثم اختبر الاستدلال؛ هذا لا يعني أن المفتاح غير صالح.' : 'The models endpoint is unsupported. Enter a model ID manually and test inference; this does not mean the key is invalid.')
      });
    } catch (caught) { recordFailure(caught); }
    finally { setBusy(null); }
  };

  const testDraft = async () => {
    if (!form.defaultModel.trim()) {
      setNotice({ tone: 'error', text: language === 'ar' ? 'اختر Model ID مكتشفًا أو أدخله يدويًا قبل اختبار الاستدلال.' : 'Select a discovered model ID or enter one manually before testing inference.' });
      return;
    }
    setBusy('test'); setNotice(null); setDiagnostic(null);
    try {
      const response = await request<ProviderTestResponse>('/api/providers/test', {
        method: 'POST',
        body: JSON.stringify({ ...payload(true), model: form.defaultModel.trim() })
      });
      setDiagnostic(response.diagnostic ?? null);
      applyModels(response);
      if (response.model) setForm((current) => ({ ...current, defaultModel: response.model! }));
      setNotice({ tone: 'success', text: `${t('connectionSuccessful')} — ${response.model ?? form.defaultModel}` });
    } catch (caught) { recordFailure(caught); }
    finally { setBusy(null); }
  };

  const discoverSavedModels = async (provider: ProviderSummary) => {
    setBusy(`models-${provider.id}`); setNotice(null); setDiagnostic(null);
    try {
      const response = await request<ModelResponse>(`/api/providers/${provider.id}/models`);
      setEditingId(provider.id);
      setForm({
        name: provider.name,
        type: provider.type,
        protocol: provider.protocol,
        defaultModel: provider.default_model ?? '',
        baseUrl: provider.base_url ?? '',
        apiKey: '',
        customHeaders: '',
        streamingEnabled: provider.streaming_enabled !== false
      });
      applyModels(response);
      setNotice({ tone: response.supported ? 'success' : 'info', text: response.supported
        ? (language === 'ar' ? `تم اكتشاف ${response.models.length} نموذجًا.` : `Discovered ${response.models.length} models.`)
        : (language === 'ar' ? 'الاكتشاف غير مدعوم؛ أبقِ Model ID اليدوي ثم اختبره.' : 'Discovery is unsupported; keep a manual model ID and test it.') });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) { recordFailure(caught); }
    finally { setBusy(null); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.defaultModel.trim()) {
      setNotice({ tone: 'error', text: language === 'ar' ? 'يجب اختيار Model ID حقيقي قبل الحفظ والفحص.' : 'Choose an actual model ID before saving and verifying.' });
      return;
    }
    setBusy('save'); setNotice(null); setDiagnostic(null);
    try {
      let id = editingId;
      if (editingId) {
        await request(`/api/providers/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload(false)) });
      } else {
        const created = await request<{ provider: ProviderSummary }>('/api/providers', { method: 'POST', body: JSON.stringify(payload(true)) });
        id = created.provider.id;
      }
      if (!id) throw new Error('provider_id_missing');
      const tested = await request<ProviderTestResponse>(`/api/providers/${id}/test`, { method: 'POST', body: '{}' });
      const finalDiagnostic = tested.diagnostic ?? null;
      reset();
      setDiagnostic(finalDiagnostic);
      setNotice({ tone: 'success', text: language === 'ar' ? `تم الحفظ والتحقق باستخدام ${tested.model ?? form.defaultModel}.` : `Saved and verified with ${tested.model ?? form.defaultModel}.` });
      await load();
    } catch (caught) { recordFailure(caught); await load(); }
    finally { setBusy(null); }
  };

  const testSaved = async (id: string) => {
    setBusy(`test-${id}`); setNotice(null); setDiagnostic(null);
    try {
      const response = await request<ProviderTestResponse>(`/api/providers/${id}/test`, { method: 'POST', body: '{}' });
      setDiagnostic(response.diagnostic ?? null);
      setNotice({ tone: 'success', text: `${t('connectionSuccessful')} — ${response.model ?? '—'}` });
      await load();
    } catch (caught) { recordFailure(caught); await load(); }
    finally { setBusy(null); }
  };

  const edit = (provider: ProviderSummary) => {
    setEditingId(provider.id);
    setForm({
      name: provider.name,
      type: provider.type,
      protocol: provider.protocol,
      defaultModel: provider.default_model ?? '',
      baseUrl: provider.base_url ?? '',
      apiKey: '',
      customHeaders: '',
      streamingEnabled: provider.streaming_enabled !== false
    });
    setModelSuggestions([]);
    setDiagnostic(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (id: string) => {
    if (!window.confirm(language === 'ar' ? 'حذف المزوّد وفصله عن المحادثات؟' : 'Delete this provider and detach it from chats?')) return;
    setBusy(`delete-${id}`);
    try { await request(`/api/providers/${id}`, { method: 'DELETE' }); if (editingId === id) reset(); await load(); }
    catch (caught) { setNotice({ tone: 'error', text: formatError(caught, language) }); }
    finally { setBusy(null); }
  };

  const changeType = (type: string) => {
    const definition = catalog.find((entry) => entry.id === type);
    setForm((current) => ({
      ...current,
      type,
      protocol: definition?.adapter ?? current.protocol,
      baseUrl: definition?.defaultBaseUrl ?? '',
      defaultModel: type === 'omniroute' ? 'auto' : ''
    }));
    setModelSuggestions(definition?.modelExamples.slice() ?? []);
    setDiagnostic(null);
  };

  return <div className="page-stack providers-page">
    <PageHeader eyebrow={t('settings')} title={t('providers')} description={language === 'ar' ? 'احفظ البروتوكول والرابط والمفتاح بأمان، اكتشف Model IDs الفعلية، ثم اختبر استدلالًا حقيقيًا دون افتراض نموذج OpenAI.' : 'Save the protocol, endpoint, and key securely; discover actual model IDs, then run a real inference test without assuming an OpenAI model.'} />
    {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}><pre>{notice.text}</pre></Notice>}
    <section className="panel provider-editor">
      <div className="section-heading"><div><h2>{editingId ? t('edit') : t('addProvider')}</h2><p>{language === 'ar' ? 'NaraRouter يستخدم OpenAI-compatible مع https://router.bynara.id/v1. يمكن لصق /models أو /chat/completions وسيُنظّف الرابط دون تكرار /v1.' : 'NaraRouter uses OpenAI-compatible at https://router.bynara.id/v1. You may paste /models or /chat/completions; the endpoint is normalized without duplicating /v1.'}</p></div>{editingId && <button type="button" className="ghost" onClick={reset}>{t('cancel')}</button>}</div>
      <form onSubmit={save} className="form-grid provider-form">
        <label><span>{t('name')}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder={selectedDefinition.label} /></label>
        <label><span>{t('type')}</span><select value={form.type} onChange={(event) => changeType(event.target.value)}>{catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
        {form.type === 'omniroute' && <div className="span-2"><Notice tone="info">{language === 'ar' ? 'شغّل OmniRoute كخدمة مستقلة، أنشئ مفتاحًا من Endpoints، ثم ضع رابط API المنتهي بـ /v1. محليًا: http://127.0.0.1:20128/v1. على Railway استخدم رابط HTTPS عام لخدمة OmniRoute المنفصلة؛ localhost لا يصل بين خدمتين.' : 'Run OmniRoute as a separate service, create an Endpoint key, then enter its API URL ending in /v1. Local: http://127.0.0.1:20128/v1. On Railway use the separate OmniRoute service public HTTPS URL; localhost does not cross services.'}</Notice></div>}
        <label><span>{language === 'ar' ? 'البروتوكول' : 'Protocol'}</span><select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value as ProviderProtocol })}><option value="openai">OpenAI</option><option value="openai-compatible">OpenAI-compatible</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select></label>
        <label><span>{t('baseUrl')}</span><input inputMode="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} required={selectedDefinition.baseUrlRequired || form.protocol === 'openai-compatible'} placeholder="https://router.bynara.id/v1" /></label>
        <label className="span-2"><span>{t('apiKey')}</span><input type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={editingId ? (language === 'ar' ? 'اتركه فارغًا للاحتفاظ بالمفتاح الحالي' : 'Leave blank to keep the current key') : ''} required={!editingId && selectedDefinition.apiKeyRequired} />{editingId && <small>{language === 'ar' ? 'لن يُعاد عرض المفتاح المحفوظ، ولن يُرسل الـmask إلى الخادم.' : 'The saved key is never returned, and its mask is never submitted as a credential.'}</small>}</label>
        <label className="span-2"><span>{language === 'ar' ? 'Custom headers (JSON اختياري)' : 'Custom headers (optional JSON)'}</span><textarea rows={3} value={form.customHeaders} onChange={(event) => setForm({ ...form, customHeaders: event.target.value })} placeholder={'{"HTTP-Referer":"https://example.com","X-Title":"Moataz AI"}'} />{editingId && providers.find((provider) => provider.id === editingId)?.has_custom_headers && <small>{language === 'ar' ? 'توجد Headers مشفرة محفوظة. اترك الحقل فارغًا لمسحها أو أعد إدخالها لاستبدالها.' : 'Encrypted headers are saved. Leave this field empty to clear them, or re-enter them to replace them.'}</small>}</label>
        <label><span>{t('model')}</span><input list="provider-models" value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} autoComplete="off" placeholder={language === 'ar' ? 'Model ID فعلي' : 'Actual model ID'} /><datalist id="provider-models">{modelSuggestions.map((model) => <option value={model} key={model} />)}</datalist><small>{form.type === 'omniroute' ? (language === 'ar' ? 'يمكن استخدام auto أو auto/coding أو أي Model ID حقيقي يعيده OmniRoute.' : 'Use auto, auto/coding, or any concrete model ID returned by OmniRoute.') : (language === 'ar' ? 'لا تستخدم auto؛ اختر قيمة id من /models أو أدخلها يدويًا.' : 'Do not use auto; select an id from /models or enter it manually.')}</small></label>
        <label className="checkbox-row"><input type="checkbox" checked={form.streamingEnabled} onChange={(event) => setForm({ ...form, streamingEnabled: event.target.checked })} /><span>{language === 'ar' ? 'تفعيل Streaming بعد نجاح الاتصال' : 'Enable streaming after connection succeeds'}</span></label>
        <div className="form-actions span-2 provider-actions">
          <button type="button" className="ghost" onClick={() => { void discoverDraftModels(); }} disabled={busy !== null || !canCallDraft}><SpinnerLabel active={busy === 'models'} activeText={language === 'ar' ? 'جارٍ الاكتشاف…' : 'Discovering…'} idleText={language === 'ar' ? 'اكتشاف النماذج' : 'Discover models'} /></button>
          <button type="button" className="secondary" onClick={() => { void testDraft(); }} disabled={busy !== null || !canCallDraft || !form.defaultModel.trim()}><SpinnerLabel active={busy === 'test'} activeText={t('testing')} idleText={language === 'ar' ? 'اختبار الاستدلال' : 'Test inference'} /></button>
          <button type="submit" disabled={busy !== null || !form.defaultModel.trim()}><SpinnerLabel active={busy === 'save'} activeText={language === 'ar' ? 'جارٍ الحفظ والفحص…' : 'Saving and verifying…'} idleText={language === 'ar' ? 'حفظ وفحص' : 'Save & verify'} /></button>
        </div>
      </form>
      <div className="provider-capability-note"><strong>{form.protocol}</strong><span>{selectedDefinition.label}</span><code>{form.baseUrl || '—'}</code></div>
    </section>
    {diagnostic && <DiagnosticCard diagnostic={diagnostic} language={language} />}
    <section className="panel">
      <div className="section-heading"><div><h2>{t('configuredProviders')}</h2><p>{language === 'ar' ? `${providers.filter((item) => item.validation_status === 'verified').length} جاهز من ${providers.length}` : `${providers.filter((item) => item.validation_status === 'verified').length} ready of ${providers.length}`}</p></div><button type="button" className="ghost" onClick={() => { void load(); }}>{t('refresh')}</button></div>
      {providers.length === 0 ? <EmptyState title={t('noProviders')} /> : <div className="resource-list provider-list">{providers.map((provider) => <article className={`resource-card provider-resource ${provider.validation_status}`} key={provider.id}>
        <div className="resource-main"><div className="resource-title"><strong>{provider.name}</strong><StatusBadge status={provider.validation_status} t={t} /></div><p>{provider.type} · {provider.protocol} · <code>{provider.default_model || '—'}</code></p><small>{provider.base_url || 'Default endpoint'}</small>{provider.key_mask && <small>{language === 'ar' ? 'المفتاح: ' : 'Key: '}{provider.key_mask}</small>}{provider.validation_error_code && <code>{provider.validation_error_code}</code>}{provider.last_error_message && <small>{provider.last_error_message}</small>}{provider.validated_at && <small>{language === 'ar' ? 'آخر فحص: ' : 'Last checked: '}{new Date(provider.validated_at).toLocaleString(language === 'ar' ? 'ar' : 'en')}</small>}</div>
        <div className="resource-actions"><button type="button" className="ghost" onClick={() => { void discoverSavedModels(provider); }} disabled={busy !== null}><SpinnerLabel active={busy === `models-${provider.id}`} activeText={language === 'ar' ? 'اكتشاف…' : 'Discovering…'} idleText={language === 'ar' ? 'النماذج' : 'Models'} /></button><button type="button" className="secondary" onClick={() => { void testSaved(provider.id); }} disabled={busy !== null}><SpinnerLabel active={busy === `test-${provider.id}`} activeText={t('testing')} idleText={language === 'ar' ? 'فحص' : 'Test'} /></button><button type="button" className="ghost" onClick={() => edit(provider)}>{t('edit')}</button><button type="button" className="danger ghost" onClick={() => { void remove(provider.id); }} disabled={busy !== null}>{t('delete')}</button></div>
      </article>)}</div>}
    </section>
  </div>;
}
