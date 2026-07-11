import { AppError } from '../errors.js';
import { redactText } from '../redaction.js';
import type { ProviderDiagnosticResult, ProviderDiagnosticStatus } from './types.js';

type UnknownRecord = Record<string, unknown>;

type DiagnosticContext = {
  requestId?: string | undefined;
  testedEndpoint?: string | undefined;
  testedModel?: string | undefined;
  latencyMs?: number | undefined;
  discoverySucceeded?: boolean | undefined;
};

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof AppError) {
    const details = record(error.details);
    if (typeof details.upstreamStatus === 'number') return details.upstreamStatus;
    if (typeof details.httpStatus === 'number') return details.httpStatus;
  }
  const root = record(error);
  const response = record(root.response);
  const values = [root.status, root.statusCode, response.status];
  return values.find((value): value is number => typeof value === 'number' && Number.isInteger(value));
}

function providerCodeOf(error: unknown): string | undefined {
  const root = record(error);
  const response = record(root.response);
  const body = record(response.data ?? response.body);
  const nested = record(body.error);
  const candidates = [nested.code, nested.type, body.code, body.type, root.code];
  return candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.slice(0, 160);
}

function messageOf(error: unknown): string {
  if (error instanceof AppError && error.message) return redactText(error.message).slice(0, 1200);
  const root = record(error);
  const response = record(root.response);
  const body = record(response.data ?? response.body);
  const nested = record(body.error);
  const candidates = [nested.message, nested.detail, body.message, body.detail, root.message, typeof error === 'string' ? error : undefined];
  return (candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? 'Provider request failed.').trim().slice(0, 1200);
}

function headerValue(error: unknown, names: readonly string[]): string | undefined {
  const root = record(error);
  const response = record(root.response);
  const headers = response.headers;
  if (headers && typeof (headers as Headers).get === 'function') {
    for (const name of names) {
      const value = (headers as Headers).get(name);
      if (value) return value.slice(0, 200);
    }
  }
  const map = record(headers);
  for (const name of names) {
    const value = map[name] ?? map[name.toLowerCase()];
    if (typeof value === 'string' && value) return value.slice(0, 200);
  }
  return undefined;
}

function result(
  status: ProviderDiagnosticStatus,
  input: {
    success?: boolean | undefined;
    keyValid: boolean | null;
    providerReachable: boolean | null;
    modelAvailable: boolean | null;
    retryable: boolean;
    message: string;
    userMessageAr: string;
    userMessageEn: string;
    httpStatus?: number | undefined;
    providerCode?: string | undefined;
    upstreamRequestId?: string | undefined;
  },
  context: DiagnosticContext
): ProviderDiagnosticResult {
  return {
    success: input.success ?? false,
    status,
    keyValid: input.keyValid,
    providerReachable: input.providerReachable,
    modelAvailable: input.modelAvailable,
    retryable: input.retryable,
    ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
    ...(input.providerCode ? { providerCode: input.providerCode } : {}),
    message: input.message,
    userMessageAr: input.userMessageAr,
    userMessageEn: input.userMessageEn,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(input.upstreamRequestId ? { upstreamRequestId: input.upstreamRequestId } : {}),
    ...(context.testedEndpoint ? { testedEndpoint: context.testedEndpoint } : {}),
    ...(context.testedModel ? { testedModel: context.testedModel } : {}),
    ...(context.latencyMs !== undefined ? { latencyMs: context.latencyMs } : {})
  };
}

export function readyDiagnostic(context: DiagnosticContext): ProviderDiagnosticResult {
  return result('ready', {
    success: true,
    keyValid: true,
    providerReachable: true,
    modelAvailable: true,
    retryable: false,
    message: 'The provider accepted the credentials and completed a real inference request.',
    userMessageAr: 'نجح الوصول إلى المزوّد والمفتاح والنموذج، وتم تنفيذ طلب استدلال حقيقي.',
    userMessageEn: 'The provider, credentials, and model passed a real inference request.'
  }, context);
}

export function unsupportedDiscoveryDiagnostic(context: DiagnosticContext): ProviderDiagnosticResult {
  return result('model_discovery_unsupported', {
    keyValid: context.discoverySucceeded ? true : null,
    providerReachable: true,
    modelAvailable: null,
    retryable: false,
    message: 'The provider does not expose a compatible model discovery endpoint. Enter a model ID manually.',
    userMessageAr: 'المزوّد لا يوفر مسارًا متوافقًا لاكتشاف النماذج. يمكنك إدخال معرف النموذج يدويًا ثم اختباره.',
    userMessageEn: 'The provider does not expose a compatible model discovery endpoint. Enter a model ID manually.'
  }, context);
}

export function diagnoseProviderError(error: unknown, context: DiagnosticContext = {}): ProviderDiagnosticResult {
  const httpStatus = statusOf(error);
  const providerCode = providerCodeOf(error);
  const message = messageOf(error);
  const lower = `${providerCode ?? ''} ${message}`.toLowerCase();
  const upstreamRequestId = headerValue(error, ['x-request-id', 'request-id', 'cf-ray', 'x-amzn-requestid']);
  const common = { message, httpStatus, providerCode, upstreamRequestId };

  if (/no available channel|no channel available|no available provider|model.+temporarily unavailable/.test(lower)) {
    return result('model_unavailable', {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: false, retryable: true,
      userMessageAr: 'تم الوصول إلى المزوّد، لكن لا توجد قناة متاحة حاليًا للنموذج المحدد. اختر نموذجًا آخر من قائمة النماذج المتاحة أو أعد المحاولة لاحقًا.',
      userMessageEn: 'The provider was reached, but no channel is currently available for the selected model. Choose another available model or retry later.'
    }, context);
  }
  if (httpStatus === 401 || /invalid api key|incorrect api key|unauthorized|authentication failed|invalid token/.test(lower)) {
    return result('invalid_api_key', {
      ...common, keyValid: false, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'رفض المزوّد مفتاح API أو التوكن. تحقق من المفتاح وأعد الفحص.',
      userMessageEn: 'The provider rejected the API key or token.'
    }, context);
  }
  if (httpStatus === 403 || /forbidden|permission denied|insufficient scope|access denied/.test(lower)) {
    return result('forbidden', {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'تم الوصول إلى المزوّد، لكن المفتاح لا يملك الصلاحية المطلوبة للنموذج أو المورد.',
      userMessageEn: 'The provider was reached, but the key lacks the required permission.'
    }, context);
  }
  if (httpStatus === 429) {
    if (/insufficient[_ ]quota|quota exceeded|credits? exhausted|insufficient credits?/.test(lower)) {
      return result('insufficient_quota', {
        ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: false,
        userMessageAr: 'المفتاح مقبول، لكن الحصة أو الرصيد المتاح نفد.',
        userMessageEn: 'The key was accepted, but the available quota or credits are exhausted.'
      }, context);
    }
    if (/billing|required payment|payment required|add credits/.test(lower)) {
      return result('billing_required', {
        ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: false,
        userMessageAr: 'المزوّد يتطلب تفعيل الفوترة أو إضافة رصيد قبل تنفيذ الطلب.',
        userMessageEn: 'The provider requires billing activation or additional credits.'
      }, context);
    }
    return result('rate_limited', {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: true,
      userMessageAr: 'تم بلوغ حد الطلبات أو التوكنات. انتظر ثم أعد المحاولة.',
      userMessageEn: 'The request or token rate limit was reached. Retry later.'
    }, context);
  }
  if (httpStatus === 402 || /payment required|billing required|requires? more credits?|credit balance/.test(lower)) {
    return result('billing_required', {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'المزوّد يتطلب رصيدًا أو تفعيل الفوترة قبل تنفيذ الطلب.',
      userMessageEn: 'The provider requires credits or billing before the request can run.'
    }, context);
  }
  if (httpStatus === 404) {
    if (/model|deployment/.test(lower)) {
      return result('model_not_found', {
        ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: false, retryable: false,
        userMessageAr: 'تم الوصول إلى المزوّد، لكن النموذج أو النشر المحدد غير موجود لهذا الحساب.',
        userMessageEn: 'The provider was reached, but the selected model or deployment was not found.'
      }, context);
    }
    return result('endpoint_not_found', {
      ...common, keyValid: null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'تم الوصول إلى المضيف، لكن مسار API المطلوب غير موجود. تحقق من Base URL.',
      userMessageEn: 'The host was reached, but the requested API endpoint does not exist. Check the base URL.'
    }, context);
  }
  if (httpStatus === 408 || /abort|timeout|timed out|deadline exceeded/.test(lower)) {
    return result('timeout', {
      ...common, keyValid: null, providerReachable: null, modelAvailable: null, retryable: true,
      userMessageAr: 'انتهت مهلة الاتصال بالمزوّد. أعد المحاولة لاحقًا.',
      userMessageEn: 'The provider request timed out. Retry later.'
    }, context);
  }
  if (httpStatus !== undefined && httpStatus >= 500) {
    return result('provider_unavailable', {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: true,
      userMessageAr: 'خدمة المزوّد غير متاحة مؤقتًا. هذا لا يعني أن المفتاح خاطئ.',
      userMessageEn: 'The provider is temporarily unavailable. This does not mean the key is invalid.'
    }, context);
  }
  if (/enotfound|dns|name not resolved|getaddrinfo/.test(lower)) {
    return result('dns_error', {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: true,
      userMessageAr: 'تعذر حل اسم مضيف المزوّد عبر DNS.',
      userMessageEn: 'The provider hostname could not be resolved through DNS.'
    }, context);
  }
  if (/certificate|tls|ssl|self signed|unable to verify/.test(lower)) {
    return result('tls_error', {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: false,
      userMessageAr: 'فشل اتصال TLS/SSL مع المزوّد. تحقق من الشهادة والرابط.',
      userMessageEn: 'The TLS/SSL connection to the provider failed.'
    }, context);
  }
  if (/econn|fetch failed|network|socket|connection refused/.test(lower)) {
    return result('network_error', {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: true,
      userMessageAr: 'تعذر الاتصال بالشبكة أو بخادم المزوّد.',
      userMessageEn: 'The provider could not be reached over the network.'
    }, context);
  }
  if (httpStatus === 400 || httpStatus === 409 || httpStatus === 415 || httpStatus === 422) {
    return result('invalid_request', {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'رفض المزوّد صيغة الطلب أو أحد المعاملات. هذا لا يعني أن المفتاح خاطئ.',
      userMessageEn: 'The provider rejected the request payload or a parameter. This does not mean the key is invalid.'
    }, context);
  }
  if (/invalid json|malformed json|unexpected token|html response|invalid response/.test(lower)) {
    return result('invalid_response', {
      ...common, keyValid: null, providerReachable: true, modelAvailable: null, retryable: true,
      userMessageAr: 'أعاد المزوّد استجابة غير صالحة أو غير متوقعة.',
      userMessageEn: 'The provider returned an invalid or unexpected response.'
    }, context);
  }
  return result('unknown_error', {
    ...common, keyValid: null, providerReachable: null, modelAvailable: null, retryable: false,
    userMessageAr: 'أعاد المزوّد خطأ غير معروف. راجع رقم الطلب ورسالة المزوّد المنقحة.',
    userMessageEn: 'The provider returned an unknown error. Review the request ID and redacted provider message.'
  }, context);
}

export function diagnosticToAppError(diagnostic: ProviderDiagnosticResult): AppError {
  const statusMap: Record<ProviderDiagnosticStatus, number> = {
    ready: 200,
    invalid_api_key: 422,
    forbidden: 403,
    invalid_base_url: 422,
    endpoint_not_found: 422,
    model_not_found: 422,
    model_unavailable: 503,
    provider_unavailable: 503,
    rate_limited: 429,
    insufficient_quota: 402,
    billing_required: 402,
    timeout: 504,
    network_error: 503,
    dns_error: 422,
    tls_error: 502,
    unsupported_protocol: 422,
    model_discovery_unsupported: 422,
    invalid_request: 422,
    invalid_response: 502,
    unknown_error: 502
  };
  return new AppError(`provider_${diagnostic.status}`, statusMap[diagnostic.status], diagnostic.message, {
    diagnostic,
    stage: diagnostic.status,
    retryable: diagnostic.retryable,
    ...(diagnostic.httpStatus !== undefined ? { upstreamStatus: diagnostic.httpStatus } : {}),
    ...(diagnostic.upstreamRequestId ? { providerRequestId: diagnostic.upstreamRequestId } : {})
  });
}
