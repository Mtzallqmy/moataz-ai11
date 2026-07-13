import { AppError } from '../errors.js';
import { redactText } from '../redaction.js';
import type { ModelDiscoveryResult, ProviderDiagnosticResult, ProviderDiagnosticStatus } from './types.js';

type UnknownRecord = Record<string, unknown>;

export type ProviderErrorContext = {
  requestId?: string;
  testedEndpoint?: string;
  testedModel?: string;
  discovery?: ModelDiscoveryResult;
  latencyMs?: number;
  providerReachable?: boolean | null;
  keyValid?: boolean | null;
};

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function numericStatus(error: unknown): number | undefined {
  const root = record(error);
  const response = record(root?.response);
  const details = record(root?.details);
  const values = [root?.status, root?.statusCode, response?.status, details?.httpStatus, details?.upstreamStatus];
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  }
  return undefined;
}

function providerCode(error: unknown): string | undefined {
  const root = record(error);
  const response = record(root?.response);
  const data = record(response?.data) ?? record(response?.body);
  const nested = record(data?.error) ?? record(root?.error);
  return stringValue(nested?.code, nested?.type, data?.code, data?.type, root?.code);
}

function messageFrom(error: unknown): string {
  const root = record(error);
  const response = record(root?.response);
  const data = record(response?.data) ?? record(response?.body);
  const nested = record(data?.error) ?? record(root?.error);
  return redactText(stringValue(
    nested?.message,
    nested?.detail,
    data?.message,
    data?.detail,
    root?.message,
    typeof error === 'string' ? error : undefined
  ) ?? 'Upstream provider request failed.').slice(0, 1200);
}

function upstreamRequestId(error: unknown): string | undefined {
  const root = record(error);
  const details = record(root?.details);
  const headers = record(root?.headers) ?? record(record(root?.response)?.headers);
  return stringValue(
    details?.upstreamRequestId,
    headers?.['x-request-id'],
    headers?.['request-id'],
    headers?.['x-amzn-requestid'],
    headers?.['cf-ray']
  );
}

function networkCode(error: unknown): string {
  const root = record(error);
  const cause = record(root?.cause);
  return String(root?.code ?? cause?.code ?? '').toUpperCase();
}

function result(
  status: ProviderDiagnosticStatus,
  message: string,
  input: ProviderErrorContext & {
    success?: boolean;
    keyValid: boolean | null;
    providerReachable: boolean | null;
    modelAvailable: boolean | null;
    retryable: boolean;
    httpStatus?: number;
    providerCode?: string;
    upstreamRequestId?: string;
    userMessageAr: string;
    userMessageEn: string;
  }
): ProviderDiagnosticResult {
  return {
    success: input.success === true,
    status,
    keyValid: input.keyValid,
    providerReachable: input.providerReachable,
    modelAvailable: input.modelAvailable,
    retryable: input.retryable,
    ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
    ...(input.providerCode ? { providerCode: input.providerCode } : {}),
    message,
    userMessageAr: input.userMessageAr,
    userMessageEn: input.userMessageEn,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.upstreamRequestId ? { upstreamRequestId: input.upstreamRequestId } : {}),
    ...(input.testedEndpoint ? { testedEndpoint: input.testedEndpoint } : {}),
    ...(input.testedModel ? { testedModel: input.testedModel } : {}),
    ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
    ...(input.discovery ? { discovery: input.discovery } : {})
  };
}

export function readyDiagnostic(context: ProviderErrorContext & { testedModel: string; testedEndpoint?: string }): ProviderDiagnosticResult {
  return result('ready', 'The provider accepted the key and completed a real inference request.', {
    ...context,
    success: true,
    keyValid: true,
    providerReachable: true,
    modelAvailable: true,
    retryable: false,
    userMessageAr: 'تم الوصول إلى المزوّد ونجح تنفيذ طلب حقيقي بالنموذج المحدد.',
    userMessageEn: 'The provider was reached and a real inference request succeeded.'
  });
}

export function discoveryUnsupportedDiagnostic(context: ProviderErrorContext): ProviderDiagnosticResult {
  return result('model_discovery_unsupported', 'The provider does not expose a compatible models endpoint. Enter a model ID manually.', {
    ...context,
    keyValid: context.keyValid ?? null,
    providerReachable: context.providerReachable ?? true,
    modelAvailable: null,
    retryable: false,
    userMessageAr: 'المزوّد لا يدعم اكتشاف النماذج عبر endpoint متوافق. أدخل معرّف النموذج يدويًا ثم نفّذ الفحص.',
    userMessageEn: 'The provider does not expose compatible model discovery. Enter a model ID manually and run the test.'
  });
}

export function classifyProviderError(error: unknown, context: ProviderErrorContext = {}): ProviderDiagnosticResult {
  if (error instanceof AppError) {
    const details = record(error.details);
    const diagnostic = details?.diagnostic;
    if (diagnostic && typeof diagnostic === 'object' && !Array.isArray(diagnostic)) {
      return diagnostic as ProviderDiagnosticResult;
    }
  }

  const httpStatus = numericStatus(error);
  const code = providerCode(error);
  const message = messageFrom(error);
  const normalized = `${message} ${code ?? ''}`.toLowerCase();
  const request = upstreamRequestId(error);
  const common = {
    ...context,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(code ? { providerCode: code } : {}),
    ...(request ? { upstreamRequestId: request } : {})
  };

  if (/no available channel for model|no channel available|model.*temporarily unavailable|deployment.*unavailable/.test(normalized)) {
    return result('model_unavailable', message, {
      ...common,
      keyValid: context.keyValid ?? (context.discovery?.supported ? true : null),
      providerReachable: true,
      modelAvailable: false,
      retryable: true,
      userMessageAr: 'تم الوصول إلى المزوّد، لكن لا توجد قناة متاحة حاليًا للنموذج المحدد. اختر نموذجًا آخر من قائمة النماذج المتاحة أو أعد المحاولة لاحقًا.',
      userMessageEn: 'The provider was reached, but no channel is currently available for the selected model. Choose another discovered model or try again later.'
    });
  }

  const netCode = networkCode(error);
  if (netCode === 'ENOTFOUND' || netCode === 'EAI_AGAIN' || /dns|hostname.*resolve/.test(normalized)) {
    return result('dns_error', message, {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: true,
      userMessageAr: 'تعذر حل اسم نطاق المزوّد. تحقق من اسم المضيف وDNS.',
      userMessageEn: 'The provider hostname could not be resolved. Check the hostname and DNS.'
    });
  }
  if (/certificate|tls|ssl|self signed|unable to verify/.test(normalized) || ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(netCode)) {
    return result('tls_error', message, {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: false,
      userMessageAr: 'فشل اتصال TLS بالمزوّد. تحقق من الشهادة واسم المضيف.',
      userMessageEn: 'TLS validation failed. Check the certificate and hostname.'
    });
  }
  if (/abort|timeout|timed out|deadline exceeded/.test(normalized) || netCode === 'ETIMEDOUT') {
    return result('timeout', message, {
      ...common, keyValid: context.keyValid ?? null, providerReachable: null, modelAvailable: null, retryable: true,
      userMessageAr: 'انتهت مهلة الاتصال بالمزوّد. أعد المحاولة لاحقًا.',
      userMessageEn: 'The provider request timed out. Try again later.'
    });
  }
  if (httpStatus === 401) {
    return result('invalid_api_key', message, {
      ...common, keyValid: false, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'رفض المزوّد مفتاح API أو التوكن. تحقق من المفتاح ثم أعد الفحص.',
      userMessageEn: 'The provider rejected the API key or token. Check it and test again.'
    });
  }
  if (httpStatus === 403) {
    return result('forbidden', message, {
      ...common, keyValid: context.keyValid ?? null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'تم الوصول إلى المزوّد لكن المفتاح لا يملك الصلاحية المطلوبة.',
      userMessageEn: 'The provider was reached, but the key lacks the required permission.'
    });
  }
  if (httpStatus === 402 || /payment required|billing required|add credits?|insufficient credits?|credit balance/.test(normalized)) {
    return result('billing_required', message, {
      ...common, keyValid: context.keyValid ?? true, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'المفتاح مقبول، لكن المزوّد يطلب رصيدًا أو تفعيل الفوترة قبل تنفيذ الطلب.',
      userMessageEn: 'The key is accepted, but the provider requires credits or billing before inference.'
    });
  }
  if (httpStatus === 429) {
    if (/insufficient[_ ]quota|quota exceeded|credits? exhausted|out of credits/.test(normalized)) {
      return result('insufficient_quota', message, {
        ...common, keyValid: context.keyValid ?? true, providerReachable: true, modelAvailable: null, retryable: false,
        userMessageAr: 'نفد رصيد أو حصة الحساب لدى المزوّد.',
        userMessageEn: 'The provider account quota or credits are exhausted.'
      });
    }
    return result('rate_limited', message, {
      ...common, keyValid: context.keyValid ?? true, providerReachable: true, modelAvailable: context.modelAvailable ?? null, retryable: true,
      userMessageAr: 'تم بلوغ حد الطلبات أو التوكنات. انتظر ثم أعد المحاولة.',
      userMessageEn: 'The request or token rate limit was reached. Wait and try again.'
    });
  }
  if (httpStatus === 404) {
    const endpoint = context.testedEndpoint ?? '';
    if (/model|deployment/.test(normalized) || context.testedModel) {
      return result(/deployment/.test(normalized) ? 'model_unavailable' : 'model_not_found', message, {
        ...common, keyValid: context.keyValid ?? null, providerReachable: true, modelAvailable: false,
        retryable: /deployment|unavailable/.test(normalized),
        userMessageAr: 'تم الوصول إلى المزوّد لكن النموذج أو deployment المحدد غير موجود أو غير متاح.',
        userMessageEn: 'The provider was reached, but the selected model or deployment is missing or unavailable.'
      });
    }
    return result('endpoint_not_found', message, {
      ...common, testedEndpoint: endpoint || context.testedEndpoint,
      keyValid: context.keyValid ?? null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'تم الوصول إلى المضيف لكن مسار API غير موجود. راجع Base URL دون تكرار endpoint.',
      userMessageEn: 'The host was reached, but the API endpoint does not exist. Check the base URL for duplicated paths.'
    });
  }
  if (httpStatus === 400 || httpStatus === 409 || httpStatus === 415 || httpStatus === 422) {
    return result('invalid_request', message, {
      ...common, keyValid: context.keyValid ?? null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'استلم المزوّد الطلب لكنه رفض الرابط أو النموذج أو صيغة الحمولة. هذا لا يعني أن المفتاح خاطئ.',
      userMessageEn: 'The provider received the request but rejected the URL, model, or payload. This does not mean the key is invalid.'
    });
  }
  if (httpStatus !== undefined && httpStatus >= 500) {
    return result('provider_unavailable', message, {
      ...common, keyValid: context.keyValid ?? null, providerReachable: true, modelAvailable: context.modelAvailable ?? null, retryable: true,
      userMessageAr: 'المزوّد غير متاح مؤقتًا أو أعاد خطأ خادم. المفتاح لا يُصنف كخاطئ.',
      userMessageEn: 'The provider is temporarily unavailable or returned a server error. The key is not classified as invalid.'
    });
  }
  if (/unsupported protocol|only http|only https/.test(normalized)) {
    return result('unsupported_protocol', message, {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: false,
      userMessageAr: 'بروتوكول الرابط غير مدعوم. استخدم HTTP أو HTTPS فقط.',
      userMessageEn: 'The URL protocol is unsupported. Use HTTP or HTTPS only.'
    });
  }
  if (/invalid url|failed to parse url|only absolute urls|base url/.test(normalized)) {
    return result('invalid_base_url', message, {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: false,
      userMessageAr: 'عنوان Base URL غير صالح أو يحتوي مسارًا مكررًا.',
      userMessageEn: 'The base URL is invalid or contains a duplicated endpoint path.'
    });
  }
  if (/invalid json|malformed json|html response|unexpected token|invalid response/.test(normalized)) {
    return result('invalid_response', message, {
      ...common, keyValid: context.keyValid ?? null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'أعاد المزوّد استجابة غير صالحة أو غير متوافقة مع البروتوكول.',
      userMessageEn: 'The provider returned an invalid or protocol-incompatible response.'
    });
  }
  if (/econn|network|fetch failed|socket|connection refused/.test(normalized) || netCode.startsWith('ECONN')) {
    return result('network_error', message, {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: true,
      userMessageAr: 'تعذر الاتصال بخادم المزوّد. تحقق من الشبكة وBase URL.',
      userMessageEn: 'Could not connect to the provider. Check the network and base URL.'
    });
  }
  return result('unknown_error', message, {
    ...common, keyValid: context.keyValid ?? null, providerReachable: context.providerReachable ?? null,
    modelAvailable: context.modelAvailable ?? null, retryable: false,
    userMessageAr: 'أعاد المزوّد خطأ غير معروف. استخدم رقم الطلب والتفاصيل المنقحة للتشخيص.',
    userMessageEn: 'The provider returned an unknown error. Use the request ID and redacted details for diagnosis.'
  });
}

export function diagnosticAppError(diagnostic: ProviderDiagnosticResult): AppError {
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
    dns_error: 503,
    tls_error: 502,
    unsupported_protocol: 422,
    model_discovery_unsupported: 409,
    invalid_request: 422,
    invalid_response: 502,
    unknown_error: 502
  };
  return new AppError(`provider_${diagnostic.status}`, statusMap[diagnostic.status], diagnostic.message, {
    diagnostic,
    stage: diagnostic.status,
    retryable: diagnostic.retryable,
    upstreamStatus: diagnostic.httpStatus,
    providerMessage: diagnostic.message
  });
}
