import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, Notice, PageHeader, SpinnerLabel, StatusBadge } from '../components/ui';
import { errorDetails, formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { ProviderCatalogEntry, ProviderDiagnostic, ProviderSummary } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type ProviderForm = { name: string; type: string; defaultModel: string; baseUrl: string; apiKey: string };
type ProviderTestResponse = { responsePreview?: string; diagnostic?: ProviderDiagnostic; model?: string };

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

function diagnosticLabel(value: string, language: Language): string {
  const ar: Record<string, string> = {
    available: 'متاح الآن', limited: 'محدود مؤقتًا', unavailable: 'غير متاح', unknown: 'غير معروف',
    free: 'مجاني', paid: 'مدفوع/يحتاج رصيدًا', mixed: 'مجاني ومدفوع',
    request_succeeded: 'نجح الطلب', credits_required: 'الرصيد أو الدفع مطلوب', rate_limited: 'تم بلوغ الحد', not_checked: 'لم يُفحص',
    supported: 'مدعوم', unsupported: 'غير معلن', failed: 'فشل', not_exposed: 'المزوّد لا يصرّح بالخطة',
    inferred_from_error: 'استنتاج من خطأ الفوترة', provider_declared: 'معلنة من المزوّد'
  };
  const en: Record<string, string> = {
    available: 'Available now', limited: 'Temporarily limited', unavailable: 'Unavailable', unknown: 'Unknown',
    free: 'Free', paid: 'Paid/credits required', mixed: 'Free and paid',
    request_succeeded: 'Request succeeded', credits_required: 'Credits or payment required', rate_limited: 'Limit reached', not_checked: 'Not checked',
    supported: 'Supported', unsupported: 'Not exposed', failed: 'Failed', not_exposed: 'Provider does not expose the plan',
    inferred_from_error: 'Inferred from billing error', provider_declared: 'Declared by provider'
  };
  return (language === 'ar' ? ar : en)[value] ?? value;
}

function DiagnosticCard({ diagnostic, language }: { diagnostic: ProviderDiagnostic; language: Language }) {
  return <section className={`provider-diagnostic ${diagnostic.completionSucceeded ? 'ok' : 'failed'}`} aria-live="polite">
    <div className="diagnostic-heading"><div><span className="eyebrow">API diagnostic</span><h3>{language === 'ar' ? 'نتيجة فحص المفتاح الفعلية' : 'Real API-key diagnostic'}</h3></div><span className={`diagnostic-signal ${diagnostic.availability}`}>{diagnosticLabel(diagnostic.availability, language)}</span></div>
    <div className="diagnostic-grid">
      <div><small>{language === 'ar' ? 'تنفيذ النموذج' : 'Model completion'}</small><strong>{diagnostic.completionSucceeded ? (language === 'ar' ? 'نجح' : 'Passed') : (language === 'ar' ? 'فشل' : 'Failed')}</strong></div>
      <div><small>{language === 'ar' ? 'الفوترة/الرصيد' : 'Billing/credits'}</small><strong>{diagnosticLabel(diagnostic.billing, language)}</strong></div>
      <div><small>{language === 'ar' ? 'نوع الخطة' : 'Plan type'}</small><strong>{diagnosticLabel(diagnostic.plan, language)}</strong></div>
      <div><small>{language === 'ar' ? 'طريقة اكتشاف الخطة' : 'Plan detection'}</small><strong>{diagnosticLabel(diagnostic.planDetection, language)}</strong></div>
      <div><small>{language === 'ar' ? 'قائمة النماذج' : 'Models endpoint'}</small><strong>{diagnosticLabel(diagnostic.modelsEndpoint, language)}{diagnostic.modelCount > 0 ? ` · ${diagnostic.modelCount}` : ''}</strong></div>
      <div><small>{language === 'ar' ? 'النموذج المختبر' : 'Tested model'}</small><strong>{diagnostic.selectedModel || '—'}</strong></div>
    </div>
    <p>{language === 'ar'
      ? diagnostic.billing === 'credits_required'
        ? 'أعلن المزوّد صراحة أن الرصيد أو الدفع مطلوب. المفتاح قد يكون صحيحًا، لكن الطلب لن يعمل قبل إضافة رصيد أو اختيار نموذج متاح.'
        : diagnostic.completionSucceeded
          ? 'المفتاح صالح ويستطيع تنفيذ طلب الآن. لا نصفه بأنه مجاني أو مدفوع عندما لا يرسل المزوّد معلومة الخطة.'
          : diagnostic.note
      : diagnostic.note}</p>
    {diagnostic.errorStage && <code>{diagnostic.errorStage} · retryable: {String(diagnostic.retryable)}</code>}
    <div className="diagnostic-evidence">{diagnostic.evidence.map((item) => <span key={item}>{item}</span>)}</div>
  </section>;
}

export function ProvidersPage({ request, t, language }: { request: Request; t: T; language: Language }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>(fallbackCatalog);
  const [form, setForm] = useState<ProviderForm>(() => emptyForm(fallbackCatalog));
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'models' | string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [diagnostic, setDiagnostic] = useState<ProviderDiagnostic | null>(null);

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
    setDiagnostic(null);
  };

  const payload = () => ({
    name: form.name.trim(),
    type: form.type,
    defaultModel: form.defaultModel.trim(),
    ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {})
  });

  const canCallDraft = !selectedDefinition.apiKeyRequired || Boolean(form.apiKey.trim());

  const recordFailure = (caught: unknown) => {
    setNotice({ tone: 'error', text: formatError(caught, language) });
    setDiagnostic(errorDetails(caught)?.diagnostic ?? null);
  };

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
    setDiagnostic(null);
    try {
      const response = await request<ProviderTestResponse>('/api/providers/test', {
        method: 'POST',
        body: JSON.stringify({
          type: form.type,
          model: form.defaultModel.trim(),
          apiKey: form.apiKey.trim(),
          ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {})
        })
      });
      setDiagnostic(response.diagnostic ?? null);
      setNotice({ tone: 'success', text: `${t('connectionSuccessful')}${response.responsePreview ? ` — ${response.responsePreview}` : ''}` });
    } catch (caught) {
      recordFailure(caught);
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
        body: JSON.stringify({ type: form.type, apiKey: form.apiKey.trim(), ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}) })
      });
      const models = response.models.length > 0 ? response.models : [...selectedDefinition.modelExamples];
      setModelSuggestions(models);
      setNotice({
        tone: response.supported ? 'success' : 'info',
        text: response.supported
          ? (language === 'ar' ? `تم تحميل ${models.length} نموذجًا متاحًا لهذا المفتاح.` : `Loaded ${models.length} models available to this key.`)
          : (language === 'ar' ? 'هذا المزود لا يوفر مسارًا عامًا لقائمة النماذج؛ أدخل الاسم يدويًا.' : 'This provider does not expose a public model-list endpoint; enter the model manually.')
      });
    } catch (caught) {
      recordFailure(caught);
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
      setNotice({ tone: response.supported ? 'success' : 'info', text: language === 'ar' ? `تم تحميل ${response.models.length} نموذجًا.` : `Loaded ${response.models.length} models.` });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) {
      recordFailure(caught);
    } finally {
      setBusy(null);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingId && selectedDefinition.apiKeyRequired && !form.apiKey.trim()) return;
    setBusy('save');
    setNotice(null);
    setDiagnostic(null);
    try {
      let id = editingId;
      if (editingId) {
        await request(`/api/providers/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload()) });
      } else {
        const created = await request<{ provider: ProviderSummary }>('/api/providers', { method: 'POST', body: JSON.stringify(payload()) });
        id = created.provider.id;
      }
      if (!id) throw new Error('provider_id_missing');
      const tested = await request<ProviderTestResponse>(`/api/providers/${id}/test`, { method: 'POST', body: '{}' });
      setDiagnostic(tested.diagnostic ?? null);
      setNotice({ tone: 'success', text: language === 'ar' ? 'تم الحفظ وفحص الاتصال وأصبح المزوّد جاهزًا للمحادثة.' : 'Saved, verified, and ready for chat.' });
      reset();
      setDiagnostic(tested.diagnostic ?? null);
      await load();
    } catch (caught) {
      recordFailure(caught);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const testSaved = async (id: string) => {
    setBusy(`test-${id}`);
    setNotice(null);
    setDiagnostic(null);
    try {
      const response = await request<ProviderTestResponse>(`/api/providers/${id}/test`, { method: 'POST', body: '{}' });
      setDiagnostic(response.diagnostic ?? null);
      setNotice({ tone: 'success', text: t('connectionSuccessful') });
      await load();
    } catch (caught) {
      recordFailure(caught);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const edit = (provider: ProviderSummary) => {
    setEditingId(provider.id);
    setForm({ name: provider.name, type: provider.type, defaultModel: provider.default_model, baseUrl: provider.base_url ?? '', apiKey: '' });
    setModelSuggestions(catalog.find((entry) => entry.id === provider.type)?.modelExamples.slice() ?? []);
    setDiagnostic(null);
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
    setForm((current) => ({ ...current, type, baseUrl: definition?.defaultBaseUrl ?? '', defaultModel: definition?.modelExamples[0] ?? '' }));
    setModelSuggestions(definition?.modelExamples.slice() ?? []);
    setDiagnostic(null);
  };

  return (
    <div className="page-stack providers-page">
      <PageHeader eyebrow={t('settings')} title={t('providers')} description={language === 'ar' ? 'أدخل المفتاح والنموذج واضغط «حفظ وفحص». لن يصبح المزوّد متاحًا للدردشة أو Telegram حتى ينجح طلب حقيقي.' : 'Enter a key and model, then Save & verify. A provider is not available to chat or Telegram until a real request succeeds.'} />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}><pre>{notice.text}</pre></Notice>}
      <section className="panel provider-editor">
        <div className="section-heading"><div><h2>{editingId ? t('edit') : t('addProvider')}</h2><p>{language === 'ar' ? 'يتم ملء Base URL تلقائيًا ويمكن تعديله لأي واجهة متوافقة مع OpenAI. الفحص يميّز المفتاح غير الصحيح، الصلاحيات، النموذج، الرصيد، حدود الاستخدام، الشبكة والمهلة.' : 'The base URL is prefilled and editable for OpenAI-compatible APIs. Diagnostics distinguish key, permission, model, billing, rate, network, and timeout failures.'}</p></div>{editingId && <button type="button" className="ghost" onClick={reset}>{t('cancel')}</button>}</div>
        <form onSubmit={save} className="form-grid provider-form">
          <label><span>{t('name')}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder={selectedDefinition.label} /></label>
          <label><span>{t('type')}</span><select value={form.type} onChange={(event) => changeType(event.target.value)}>{catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
          <label><span>{t('model')}</span><input list="provider-models" value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} required autoComplete="off" /><datalist id="provider-models">{modelSuggestions.map((model) => <option value={model} key={model} />)}</datalist></label>
          <label><span>{t('baseUrl')}</span><input inputMode="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} required={selectedDefinition.baseUrlRequired} placeholder={selectedDefinition.defaultBaseUrl ?? 'https://api.example.com/v1'} /><small>{language === 'ar' ? 'استخدم جذر OpenAI API، وغالبًا ينتهي بـ /v1.' : 'Use the OpenAI API root, usually ending in /v1.'}</small></label>
          <label className="span-2"><span>{t('apiKey')}</span><input type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={editingId ? (language === 'ar' ? 'اتركه فارغًا للاحتفاظ بالمفتاح الحالي' : 'Leave blank to keep the current key') : selectedDefinition.apiKeyRequired ? '' : (language === 'ar' ? 'اختياري لهذا المزود' : 'Optional for this provider')} required={!editingId && selectedDefinition.apiKeyRequired} /></label>
          <div className="form-actions span-2 provider-actions">
            <button type="button" className="ghost" onClick={() => { void discoverDraftModels(); }} disabled={busy !== null || !canCallDraft}><SpinnerLabel active={busy === 'models'} activeText={language === 'ar' ? 'جارٍ اكتشاف النماذج…' : 'Discovering models…'} idleText={language === 'ar' ? 'اكتشاف النماذج' : 'Discover models'} /></button>
            <button type="button" className="secondary" onClick={() => { void testDraft(); }} disabled={busy !== null || !form.defaultModel.trim() || !canCallDraft}><SpinnerLabel active={busy === 'test'} activeText={t('testing')} idleText={language === 'ar' ? 'فحص دون حفظ' : 'Test without saving'} /></button>
            <button type="submit" disabled={busy !== null}><SpinnerLabel active={busy === 'save'} activeText={language === 'ar' ? 'جارٍ الحفظ والفحص…' : 'Saving and verifying…'} idleText={language === 'ar' ? 'حفظ وفحص' : 'Save & verify'} /></button>
          </div>
        </form>
        <div className="provider-capability-note"><strong>{selectedDefinition.adapter}</strong><span>{selectedDefinition.label}</span>{selectedDefinition.modelExamples.length > 0 && <code>{selectedDefinition.modelExamples.join(' · ')}</code>}</div>
      </section>

      {diagnostic && <DiagnosticCard diagnostic={diagnostic} language={language} />}

      <section className="panel">
        <div className="section-heading"><div><h2>{t('configuredProviders')}</h2><p>{language === 'ar' ? `${providers.filter((item) => item.validation_status === 'verified').length} جاهز من ${providers.length}` : `${providers.filter((item) => item.validation_status === 'verified').length} ready of ${providers.length}`}</p></div><button type="button" className="ghost" onClick={() => { void load(); }}>{t('refresh')}</button></div>
        {providers.length === 0 ? <EmptyState title={t('noProviders')} /> : <div className="resource-list provider-list">{providers.map((provider) => (
          <article className={`resource-card provider-resource ${provider.validation_status}`} key={provider.id}>
            <div className="resource-main"><div className="resource-title"><strong>{provider.name}</strong><StatusBadge status={provider.validation_status} t={t} /></div><p>{provider.type} · {provider.default_model}</p><small>{provider.base_url || 'Default endpoint'}</small>{provider.validation_error_code && <code>{provider.validation_error_code}</code>}{provider.validated_at && <small>{language === 'ar' ? 'آخر فحص: ' : 'Last checked: '}{new Date(provider.validated_at).toLocaleString(language === 'ar' ? 'ar' : 'en')}</small>}</div>
            <div className="resource-actions"><button type="button" className="ghost" onClick={() => { void discoverSavedModels(provider); }} disabled={busy !== null}><SpinnerLabel active={busy === `models-${provider.id}`} activeText={language === 'ar' ? 'تحميل…' : 'Loading…'} idleText={language === 'ar' ? 'النماذج' : 'Models'} /></button><button type="button" className="secondary" onClick={() => { void testSaved(provider.id); }} disabled={busy !== null}><SpinnerLabel active={busy === `test-${provider.id}`} activeText={t('testing')} idleText={language === 'ar' ? 'تشخيص فعلي' : 'Run diagnostic'} /></button><button type="button" className="ghost" onClick={() => edit(provider)}>{t('edit')}</button><button type="button" className="danger ghost" onClick={() => { void remove(provider.id); }} disabled={busy !== null}>{t('delete')}</button></div>
          </article>
        ))}</div>}
      </section>
    </div>
  );
}
