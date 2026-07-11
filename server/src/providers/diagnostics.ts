import { AppError } from '../errors.js';
import { redactText } from '../redaction.js';
import { ProviderHttpError } from './http.js';
import type { ModelDiscoveryResult, ProviderDiagnosticResult, ProviderDiagnosticStatus } from './types.js';

type UnknownRecord = Record<string, unknown>;

type DiagnosticContext = {
  endpoint?: string | undefined;
  model?: string | undefined;
  requestId?: string | undefined;
  discovery?: ModelDiscoveryResult | undefined;
  keyValidHint?: boolean | null | undefined;
  providerReachableHint?: boolean | null | undefined;
  latencyMs?: number | undefined;
};

type ErrorDetails = {
  httpStatus?: number | undefined;
  providerCode?: string | undefined;
  message: string;
  endpoint?: string | undefined;
  upstreamRequestId?: string | undefined;
  causeCode?: string | undefined;
};

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return redactText(value.trim()).slice(0, 1200);
  }
  return undefined;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  }
  return undefined;
}

function details(error: unknown): ErrorDetails {
  if (error instanceof ProviderHttpError) {
    const payload = record(error.payload);
    const nested = record(payload?.error);
    const providerCode = stringValue(nested?.code, payload?.code, payload?.error_code);
    return {
      ...(error.status !== undefined ? { httpStatus: error.status } : {}),
      ...(providerCode ? { providerCode } : {}),
      message: redactText(error.message).slice(0, 1200),
      ...(error.endpoint ? { endpoint: error.endpoint } : {}),
      ...(error.upstreamRequestId ? { upstreamRequestId: error.upstreamRequestId } : {}),
      ...(error.causeCode ? { causeCode: error.causeCode } : {})
    };
  }
  if (error instanceof AppError) {
    const root = record(error.details);
    const httpStatus = numberValue(root?.upstreamStatus, root?.httpStatus);
    const providerCode = stringValue(root?.providerCode, root?.code);
    const endpoint = stringValue(root?.testedEndpoint, root?.endpoint);
    const upstreamRequestId = stringValue(root?.upstreamRequestId, root?.providerRequestId);
    const causeCode = stringValue(root?.causeCode);
    return {
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(providerCode ? { providerCode } : {}),
      message: stringValue(root?.providerMessage, error.message) ?? error.code,
      ...(endpoint ? { endpoint } : {}),
      ...(upstreamRequestId ? { upstreamRequestId } : {}),
      ...(causeCode ? { causeCode } : {})
    };
  }
  const root = record(error);
  const response = record(root?.response);
  const body = record(response?.data) ?? record(response?.body) ?? record(root?.error);
  const nested = record(body?.error);
  const cause = record(root?.cause);
  const httpStatus = numberValue(root?.status, root?.statusCode, response?.status, body?.status);
  const providerCode = stringValue(nested?.code, body?.code, body?.error_code, root?.code);
  const endpoint = stringValue(root?.endpoint, response?.url);
  const upstreamRequestId = stringValue(root?.request_id, response?.request_id, body?.request_id);
  const causeCode = stringValue(root?.code, cause?.code);
  return {
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(providerCode ? { providerCode } : {}),
    message: stringValue(nested?.message, body?.message, body?.detail, root?.message, typeof error === 'string' ? error : undefined) ?? 'Provider request failed.',
    ...(endpoint ? { endpoint } : {}),
    ...(upstreamRequestId ? { upstreamRequestId } : {}),
    ...(causeCode ? { causeCode } : {})
  };
}

function messages(status: ProviderDiagnosticStatus): { ar: string; en: string } {
  const values: Record<ProviderDiagnosticStatus, { ar: string; en: string }> = {
    ready: { ar: 'تم الوصول إلى المزوّد وتنفيذ طلب حقيقي بالنموذج المحدد بنجاح.', en: 'The provider was reached and a real inference request succeeded with the selected model.' },
    invalid_api_key: { ar: 'رفض المزوّد مفتاح API. تحقق من المفتاح ومن أنه لم يُلغَ أو ينتهِ.', en: 'The provider rejected the API key. Check that it is correct, active, and not revoked.' },
    forbidden: { ar: 'تم الوصول إلى المزوّد، لكن المفتاح لا يملك الصلاحية المطلوبة لهذا المورد أو النموذج.', en: 'The provider was reached, but the key does not have permission for this resource or model.' },
    invalid_base_url: { ar: 'عنوان Base URL غير صالح. أدخل عنوان HTTP أو HTTPS مطلقًا دون بيانات دخول.', en: 'The Base URL is invalid. Enter an absolute HTTP or HTTPS URL without embedded credentials.' },
    endpoint_not_found: { ar: 'تم الوصول إلى المضيف، لكن مسار API المطلوب غير موجود. تحقق من Base URL ومسار الإصدار.', en: 'The host was reached, but the requested API endpoint was not found. Check the Base URL and version path.' },
    model_not_found: { ar: 'تم الوصول إلى المزوّد، لكن اسم النموذج غير موجود أو غير متاح لهذا الحساب.', en: 'The provider was reached, but the model ID does not exist or is not available to this account.' },
    model_unavailable: { ar: 'تم الوصول إلى المزوّد، لكن لا توجد قناة متاحة حاليًا للنموذج المحدد. اختر نموذجًا آخر من قائمة النماذج المتاحة أو أعد المحاولة لاحقًا.', en: 'The provider was reached, but no channel is currently available for the selected model. Choose another discovered model or retry later.' },
    provider_unavailable: { ar: 'المزوّد غير متاح مؤقتًا أو أعاد خطأ خادم. أعد المحاولة لاحقًا.', en: 'The provider is temporarily unavailable or returned a server error. Retry later.' },
    rate_limited: { ar: 'تم بلوغ حد الطلبات أو التوكنات لدى المزوّد. انتظر ثم أعد المحاولة.', en: 'The provider request or token limit was reached. Wait and retry.' },
    insufficient_quota: { ar: 'نفدت الحصة المتاحة للحساب أو للمشروع. راجع حدود الاستخدام أو الحصة.', en: 'The account or project quota is exhausted. Review usage limits or quota.' },
    billing_required: { ar: 'المفتاح قد يكون صحيحًا، لكن المزوّد يطلب رصيدًا أو تفعيل الفوترة قبل تنفيذ الطلب.', en: 'The key may be valid, but the provider requires credits or billing before this request can run.' },
    timeout: { ar: 'انتهت مهلة الاتصال بالمزوّد. أعد المحاولة أو تحقق من حالة الخدمة.', en: 'The provider request timed out. Retry or check the provider status.' },
    network_error: { ar: 'تعذر إنشاء اتصال شبكي بالمزوّد. تحقق من العنوان والشبكة.', en: 'A network connection to the provider could not be established. Check the URL and network.' },
    dns_error: { ar: 'تعذر حل اسم مضيف المزوّد عبر DNS. تحقق من اسم النطاق.', en: 'The provider hostname could not be resolved through DNS. Check the domain name.' },
    tls_error: { ar: 'فشل اتصال TLS أو التحقق من شهادة المزوّد.', en: 'TLS connection or certificate verification failed for the provider.' },
    unsupported_protocol: { ar: 'البروتوكول غير مدعوم. استخدم HTTP أو HTTPS فقط.', en: 'The URL protocol is unsupported. Use HTTP or HTTPS only.' },
    model_discovery_unsupported: { ar: 'المزوّد لا يوفر اكتشاف النماذج عبر هذا المسار. أدخل Model ID يدويًا ثم نفذ فحصًا حقيقيًا.', en: 'The provider does not expose model discovery at this endpoint. Enter a model ID manually and run an inference test.' },
    invalid_request: { ar: 'وصل الطلب إلى المزوّد لكنه رفض صيغة الطلب أو أحد الحقول. لا يعني ذلك أن المفتاح غير صحيح.', en: 'The request reached the provider, but its payload or a parameter was rejected. This does not mean the key is invalid.' },
    invalid_response: { ar: 'أعاد المزوّد استجابة غير صالحة أو غير متوقعة.', en: 'The provider returned an invalid or unexpected response.' },
    unknown_error: { ar: 'أعاد المزوّد خطأ غير مصنف. راجع رقم الطلب ورسالة المزوّد المنقحة.', en: 'The provider returned an unclassified error. Review the request ID and redacted provider message.' }
  };
  return values[status];
}

function classify(error: unknown, context: DiagnosticContext): ProviderDiagnosticResult {
  const info = details(error);
  const normalized = `${info.providerCode ?? ''} ${info.message} ${info.causeCode ?? ''}`.toLowerCase();
  const http = info.httpStatus;
  let status: ProviderDiagnosticStatus = 'unknown_error';
  let keyValid: boolean | null = context.keyValidHint ?? null;
  let providerReachable: boolean | null = context.providerReachableHint ?? null;
  let modelAvailable: boolean | null = null;

  if (error instanceof AppError && error.code === 'provider_base_url_invalid') status = 'invalid_base_url';
  else if (error instanceof AppError && error.code === 'provider_unsupported_protocol') status = 'unsupported_protocol';
  else if (/enotfound|eai_again|dns_resolution_failed|\bdns\b/.test(normalized)) status = 'dns_error';
  else if (/certificate|cert_|unable_to_verify|self signed|\btls\b|\bssl\b/.test(normalized)) status = 'tls_error';
  else if (/abort|timeout|timed out|deadline exceeded|provider_timeout/.test(normalized) || http === 408 || http === 504) status = 'timeout';
  else if (http === 401 || /invalid[_ ]api[_ ]key|incorrect[_ ]api[_ ]key|authentication.*failed|unauthorized/.test(normalized)) status = 'invalid_api_key';
  else if (http === 403 || /forbidden|permission denied|insufficient scope|access denied/.test(normalized)) status = 'forbidden';
  else if (/no available channel|no channel available|model.*temporarily unavailable|deployment.*unavailable/.test(normalized)) status = 'model_unavailable';
  else if (http === 429 && /insufficient[_ ]quota|quota exceeded|quota exhausted/.test(normalized)) status = 'insufficient_quota';
  else if ((http === 402 || http === 429) && /billing|payment|required credits?|credit balance|insufficient credits?|credits exhausted/.test(normalized)) status = 'billing_required';
  else if (http === 429 || /rate limit|too many requests|requests per minute|tokens per minute/.test(normalized)) status = 'rate_limited';
  else if (http === 404 && /model|deployment/.test(normalized)) status = 'model_not_found';
  else if (http === 404 || http === 405) status = 'endpoint_not_found';
  else if (http === 400 || http === 409 || http === 415 || http === 422 || /invalid request|unsupported parameter|malformed payload|validation failed/.test(normalized)) status = 'invalid_request';
  else if (http !== undefined && http >= 500) status = context.model ? 'model_unavailable' : 'provider_unavailable';
  else if (/econn|connection refused|fetch failed|socket|network/.test(normalized)) status = 'network_error';
  else if (/malformed_json|html_response|invalid response|unexpected response/.test(normalized)) status = 'invalid_response';

  if (status === 'invalid_api_key') {
    keyValid = false;
    providerReachable = true;
  } else if (status === 'forbidden') {
    keyValid = keyValid ?? true;
    providerReachable = true;
  } else if (['model_not_found', 'model_unavailable', 'invalid_request', 'rate_limited', 'insufficient_quota', 'billing_required'].includes(status)) {
    providerReachable = true;
    keyValid = keyValid ?? (context.discovery?.status === 'supported' ? true : null);
  } else if (['endpoint_not_found', 'provider_unavailable'].includes(status)) {
    providerReachable = true;
  } else if (['network_error', 'dns_error', 'tls_error', 'timeout'].includes(status)) {
    providerReachable = false;
  }

  if (status === 'model_not_found' || status === 'model_unavailable') modelAvailable = false;
  const retryable = ['model_unavailable', 'provider_unavailable', 'rate_limited', 'timeout', 'network_error', 'dns_error'].includes(status);
  const localized = messages(status);
  return {
    success: false,
    status,
    keyValid,
    providerReachable,
    modelAvailable,
    retryable,
    ...(http !== undefined ? { httpStatus: http } : {}),
    ...(info.providerCode ? { providerCode: info.providerCode } : {}),
    message: info.message,
    userMessageAr: localized.ar,
    userMessageEn: localized.en,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(info.upstreamRequestId ? { upstreamRequestId: info.upstreamRequestId } : {}),
    ...(context.endpoint ?? info.endpoint ? { testedEndpoint: context.endpoint ?? info.endpoint } : {}),
    ...(context.model ? { testedModel: context.model } : {}),
    ...(context.latencyMs !== undefined ? { latencyMs: context.latencyMs } : {}),
    ...(context.discovery ? { discovery: context.discovery } : {})
  };
}

export function diagnoseProviderError(error: unknown, context: DiagnosticContext = {}): ProviderDiagnosticResult {
  return classify(error, context);
}

export function readyProviderDiagnostic(input: {
  endpoint?: string | undefined;
  model: string;
  latencyMs: number;
  requestId?: string | undefined;
  upstreamRequestId?: string | undefined;
  discovery?: ModelDiscoveryResult | undefined;
}): ProviderDiagnosticResult {
  const localized = messages('ready');
  return {
    success: true,
    status: 'ready',
    keyValid: true,
    providerReachable: true,
    modelAvailable: true,
    retryable: false,
    message: 'Provider inference probe succeeded.',
    userMessageAr: localized.ar,
    userMessageEn: localized.en,
    testedModel: input.model,
    latencyMs: input.latencyMs,
    ...(input.endpoint ? { testedEndpoint: input.endpoint } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.upstreamRequestId ? { upstreamRequestId: input.upstreamRequestId } : {}),
    ...(input.discovery ? { discovery: input.discovery } : {})
  };
}

export function providerDiagnosticError(diagnostic: ProviderDiagnosticResult): AppError {
  const statusCode = diagnostic.status === 'invalid_api_key' ? 422
    : diagnostic.status === 'forbidden' ? 403
      : diagnostic.status === 'rate_limited' ? 429
        : diagnostic.status === 'billing_required' ? 402
          : diagnostic.status === 'provider_unavailable' || diagnostic.status === 'model_unavailable' ? 503
            : diagnostic.status === 'timeout' ? 504
              : 422;
  return new AppError(`provider_${diagnostic.status}`, statusCode, diagnostic.message, {
    ...diagnostic,
    providerMessage: diagnostic.message,
    ...(diagnostic.upstreamRequestId ? { providerRequestId: diagnostic.upstreamRequestId } : {})
  });
}
