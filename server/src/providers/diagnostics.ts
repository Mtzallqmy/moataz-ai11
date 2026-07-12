import { AppError } from '../errors.js';
import { redactText } from '../redaction.js';
import type {
  ProviderDiagnosticResult,
  ProviderDiagnosticStage,
  ProviderDiagnosticStatus
} from './types.js';

type UnknownRecord = Record<string, unknown>;
type DiagnosticContext = {
  stage?: ProviderDiagnosticStage | undefined;
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
    const candidate = details.upstreamStatus ?? details.httpStatus;
    if (typeof candidate === 'number') return candidate;
  }
  const root = record(error);
  const response = record(root.response);
  return [root.status, root.statusCode, response.status]
    .find((value): value is number => typeof value === 'number' && Number.isInteger(value));
}

function bodyOf(error: unknown): UnknownRecord {
  const root = record(error);
  const response = record(root.response);
  return record(response.data ?? response.body ?? root.body);
}

function providerCodeOf(error: unknown): string | undefined {
  if (error instanceof AppError) {
    const details = record(error.details);
    if (typeof details.providerCode === 'string') return details.providerCode.slice(0, 160);
  }
  const root = record(error);
  const body = bodyOf(error);
  const nested = record(body.error);
  return [nested.code, nested.type, body.code, body.type, root.code]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim().slice(0, 160);
}

function messageOf(error: unknown): string {
  if (error instanceof AppError && error.message) return redactText(error.message).slice(0, 1200);
  const root = record(error);
  const body = bodyOf(error);
  const nested = record(body.error);
  const value = [nested.message, nested.detail, body.message, body.detail, root.message, typeof error === 'string' ? error : undefined]
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
    ?? 'Provider request failed.';
  return redactText(value).trim().slice(0, 1200);
}

function headerValue(error: unknown, names: readonly string[]): string | undefined {
  const root = record(error);
  const response = record(root.response);
  const headers = response.headers;
  if (headers instanceof Headers) {
    for (const name of names) {
      const value = headers.get(name);
      if (value) return redactText(value).slice(0, 200);
    }
  }
  const headerRecord = record(headers);
  for (const name of names) {
    const value = headerRecord[name] ?? headerRecord[name.toLowerCase()];
    if (typeof value === 'string' && value.trim()) return redactText(value).slice(0, 200);
  }
  return undefined;
}

function retryAfterSeconds(error: unknown): number | undefined {
  const raw = headerValue(error, ['retry-after']);
  if (!raw) return undefined;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

function result(
  status: ProviderDiagnosticStatus,
  stage: ProviderDiagnosticStage,
  input: Omit<ProviderDiagnosticResult, 'success' | 'ok' | 'status' | 'stage' | 'userMessage' | 'errorType'> & {
    userMessageAr: string;
    userMessageEn: string;
    errorType?: string | undefined;
  },
  context: DiagnosticContext
): ProviderDiagnosticResult {
  const success = status === 'ready';
  return {
    success,
    ok: success,
    status,
    stage,
    errorType: input.errorType ?? status.toUpperCase(),
    ...input,
    userMessage: input.userMessageAr,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.testedEndpoint ? { testedEndpoint: context.testedEndpoint } : {}),
    ...(context.testedModel ? { testedModel: context.testedModel } : {}),
    ...(context.latencyMs !== undefined ? { latencyMs: context.latencyMs } : {})
  };
}

export function readyDiagnostic(context: DiagnosticContext): ProviderDiagnosticResult {
  return result('ready', context.stage ?? 'inference', {
    keyValid: true,
    providerReachable: true,
    modelAvailable: true,
    retryable: false,
    message: 'The provider accepted the credentials and completed a real inference request.',
    technicalMessage: 'A non-streaming Chat Completions request returned a parseable completion.',
    userMessageAr: 'نجح الاتصال بالمزوّد وتم تنفيذ طلب استدلال حقيقي بالمفتاح والنموذج المحددين.',
    userMessageEn: 'The provider, credentials, and selected model passed a real inference request.'
  }, context);
}

export function unsupportedDiscoveryDiagnostic(context: DiagnosticContext): ProviderDiagnosticResult {
  return result('model_discovery_unsupported', 'model_discovery', {
    keyValid: context.discoverySucceeded ? true : null,
    providerReachable: true,
    modelAvailable: null,
    retryable: false,
    message: 'The provider does not expose a compatible model discovery endpoint.',
    technicalMessage: 'The models endpoint returned 404/405 or is not defined for this provider.',
    userMessageAr: 'المزوّد لا يوفر مسارًا متوافقًا لاكتشاف النماذج. أدخل Model ID يدويًا ثم اختبره.',
    userMessageEn: 'The provider does not expose a compatible models endpoint. Enter a model ID manually.'
  }, context);
}

export function diagnoseProviderError(error: unknown, context: DiagnosticContext = {}): ProviderDiagnosticResult {
  if (error instanceof AppError) {
    const existing = record(error.details).diagnostic;
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) return existing as ProviderDiagnosticResult;
  }

  const httpStatus = statusOf(error);
  const providerCode = providerCodeOf(error);
  const message = messageOf(error);
  const technicalMessage = message;
  const upstreamRequestId = headerValue(error, ['x-request-id', 'request-id', 'x-amzn-requestid', 'cf-ray']);
  const retryAfter = retryAfterSeconds(error);
  const lowerCode = (providerCode ?? '').toLowerCase();
  const lowerMessage = message.toLowerCase();
  const searchable = `${lowerCode} ${lowerMessage}`;
  const stage = context.stage ?? 'inference';
  const common = {
    httpStatus,
    providerCode,
    upstreamRequestId,
    technicalMessage,
    message,
    ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {})
  };

  const explicitPayment = /^(payment_required|billing_required|insufficient_funds|insufficient_credits?)$/.test(lowerCode)
    || /payment required|billing must be enabled|account balance is insufficient/.test(lowerMessage);
  const explicitQuota = /^(insufficient_quota|quota_exceeded|quota_exhausted)$/.test(lowerCode)
    || /quota (?:has been )?exceeded|insufficient quota/.test(lowerMessage);
  const explicitRate = /^(rate_limit(?:ed)?|too_many_requests)$/.test(lowerCode)
    || /rate limit|too many requests/.test(lowerMessage);
  const explicitModelPermission = /model.*(?:not allowed|forbidden|permission|access)|not authorized.*model|model_access_denied/.test(searchable);
  const explicitUnsupportedParameter = /unsupported_(?:parameter|value)|unknown parameter|unrecognized (?:request )?(?:argument|parameter)|does not support.*(?:tools|response_format|temperature)/.test(searchable);

  if (httpStatus === 401 || /^(invalid_api_key|authentication_error|unauthorized)$/.test(lowerCode)) {
    return result('invalid_api_key', 'authentication', {
      ...common, keyValid: false, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'رفض المزوّد مفتاح API أو لم يصل Authorization بصورة صحيحة. تحقق من المفتاح ثم أعد الاختبار.',
      userMessageEn: 'The provider rejected the API key or did not receive authorization correctly.'
    }, context);
  }
  if (httpStatus === 402 || explicitPayment) {
    return result('billing_required', stage, {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'أعاد المزوّد خطأ دفع أو رصيد صريحًا. فعّل الفوترة أو أضف الرصيد المطلوب لدى المزوّد.',
      userMessageEn: 'The provider explicitly reported a payment or balance requirement.'
    }, context);
  }
  if (httpStatus === 403) {
    const status: ProviderDiagnosticStatus = explicitModelPermission ? 'model_not_allowed' : 'forbidden';
    return result(status, stage, {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true,
      modelAvailable: explicitModelPermission ? false : null, retryable: false,
      userMessageAr: explicitModelPermission
        ? 'المفتاح مقبول، لكن الحساب لا يملك صلاحية استخدام النموذج المحدد.'
        : 'تمت مصادقة الطلب أو الوصول إلى المزوّد، لكن المورد أو العملية غير مسموحين لهذا المفتاح.',
      userMessageEn: explicitModelPermission
        ? 'The key is accepted, but the account cannot use the selected model.'
        : 'The provider denied access to this resource or operation.'
    }, context);
  }
  if (httpStatus === 404) {
    const isModel = Boolean(context.testedModel) && /model|deployment|engine/.test(searchable);
    return result(isModel ? 'model_not_found' : 'endpoint_not_found', stage === 'model_discovery' ? 'model_discovery' : stage, {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true,
      modelAvailable: isModel ? false : null, retryable: false,
      userMessageAr: isModel
        ? 'وصل الطلب إلى المزوّد، لكن Model ID المحدد غير موجود أو غير متاح لهذا الحساب.'
        : 'المضيف متاح لكن مسار API غير موجود. تحقق من Base URL ولا تكرر ‎/v1 أو endpoint.',
      userMessageEn: isModel
        ? 'The selected model ID was not found or is unavailable to this account.'
        : 'The API endpoint was not found. Check the normalized Base URL and endpoint path.'
    }, context);
  }
  if (httpStatus === 405 && stage === 'model_discovery') {
    return result('model_discovery_unsupported', 'model_discovery', {
      ...common, keyValid: null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'المزوّد لا يدعم طريقة اكتشاف النماذج هذه. أدخل Model ID يدويًا واختبر الاستدلال.',
      userMessageEn: 'This provider does not support this model discovery method. Enter a model ID manually.'
    }, context);
  }
  if (httpStatus === 413 || /context_length_exceeded|request too large|maximum context|too many tokens/.test(searchable)) {
    return result('context_too_large', stage, {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: true, retryable: false,
      userMessageAr: 'حجم الطلب أو سياق المحادثة أكبر من الحد الذي يقبله النموذج.',
      userMessageEn: 'The request or conversation context exceeds the model limit.'
    }, context);
  }
  if (httpStatus === 429) {
    if (explicitQuota) {
      return result('insufficient_quota', stage, {
        ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: false,
        userMessageAr: 'المفتاح مقبول، لكن المزوّد أعاد خطأ حصة مستنفدة بصورة صريحة.',
        userMessageEn: 'The key was accepted, but the provider explicitly reported exhausted quota.'
      }, context);
    }
    return result('rate_limited', stage, {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null,
      retryable: true,
      userMessageAr: retryAfter !== undefined
        ? `تم بلوغ حد الطلبات. أعد المحاولة بعد نحو ${retryAfter} ثانية.`
        : 'تم بلوغ حد الطلبات أو التوكنات مؤقتًا. أعد المحاولة لاحقًا.',
      userMessageEn: explicitRate ? 'The provider rate limit was reached.' : 'The provider returned HTTP 429.'
    }, context);
  }
  if (httpStatus === 408 || /abort|timeout|timed out|deadline exceeded/.test(searchable)) {
    return result('timeout', stage, {
      ...common, keyValid: null, providerReachable: null, modelAvailable: null, retryable: true,
      userMessageAr: 'انتهت مهلة الاتصال بالمزوّد. هذا لا يعني أن المفتاح غير صالح.',
      userMessageEn: 'The provider request timed out; this does not mean the key is invalid.'
    }, context);
  }
  if (httpStatus !== undefined && [500, 502, 503, 504].includes(httpStatus)) {
    return result('provider_unavailable', stage, {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: true,
      userMessageAr: 'المزوّد أو خدمته العليا غير متاحين مؤقتًا. أعد المحاولة لاحقًا.',
      userMessageEn: 'The provider or its upstream service is temporarily unavailable.'
    }, context);
  }
  if (explicitUnsupportedParameter) {
    return result('unsupported_parameter', stage, {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'رفض المزوّد معاملًا غير مدعوم. راجع التفاصيل التقنية وأزل المعامل المحدد.',
      userMessageEn: 'The provider rejected an unsupported parameter.'
    }, context);
  }
  if (httpStatus === 400 || httpStatus === 409 || httpStatus === 415 || httpStatus === 422) {
    return result('invalid_request', stage, {
      ...common, keyValid: context.discoverySucceeded ? true : null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'رفض المزوّد صيغة الطلب أو أحد المعاملات. لا يدل ذلك على أن المفتاح خاطئ.',
      userMessageEn: 'The provider rejected the request payload or a parameter; this does not mean the key is invalid.'
    }, context);
  }
  if (/enotfound|dns|name not resolved|getaddrinfo/.test(searchable)) {
    return result('dns_error', stage, {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: true,
      userMessageAr: 'تعذر حل اسم مضيف المزوّد عبر DNS.',
      userMessageEn: 'The provider hostname could not be resolved.'
    }, context);
  }
  if (/certificate|tls|ssl|self signed|unable to verify/.test(searchable)) {
    return result('tls_error', stage, {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: false,
      userMessageAr: 'فشل اتصال TLS/SSL مع المزوّد. تحقق من الشهادة والرابط.',
      userMessageEn: 'The TLS/SSL connection to the provider failed.'
    }, context);
  }
  if (/econn|fetch failed|network|socket|connection refused|connection reset/.test(searchable)) {
    return result('network_error', stage, {
      ...common, keyValid: null, providerReachable: false, modelAvailable: null, retryable: true,
      userMessageAr: 'تعذر الاتصال بالشبكة أو بخادم المزوّد.',
      userMessageEn: 'The provider could not be reached over the network.'
    }, context);
  }
  if (/invalid json|malformed json|unexpected token|html response|invalid response|premature close|empty (?:completion|response)|reasoning.*(?:no|without).*final answer|no user-facing final answer/.test(searchable)) {
    return result('invalid_response', stage, {
      ...common, keyValid: null, providerReachable: true, modelAvailable: null, retryable: false,
      userMessageAr: 'أعاد المزوّد استجابة غير صالحة أو أغلق البث قبل اكتماله.',
      userMessageEn: 'The provider returned an invalid response or closed the stream prematurely.'
    }, context);
  }
  return result('unknown_error', stage, {
    ...common, keyValid: null, providerReachable: null, modelAvailable: null, retryable: false,
    userMessageAr: 'أعاد المزوّد خطأ غير مصنف. راجع التفاصيل التقنية المنقحة ورقم الطلب.',
    userMessageEn: 'The provider returned an unclassified error. Review the redacted technical details.'
  }, context);
}

export function diagnosticToAppError(diagnostic: ProviderDiagnosticResult): AppError {
  const statusMap: Record<ProviderDiagnosticStatus, number> = {
    ready: 200,
    invalid_api_key: 422,
    forbidden: 403,
    model_not_allowed: 403,
    invalid_base_url: 422,
    endpoint_not_found: 422,
    model_not_found: 422,
    model_unavailable: 503,
    provider_unavailable: 503,
    rate_limited: 429,
    insufficient_quota: 429,
    billing_required: 402,
    context_too_large: 413,
    unsupported_parameter: 422,
    unsupported_streaming: 422,
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
  return new AppError(`provider_${diagnostic.status}`, statusMap[diagnostic.status], diagnostic.userMessageEn, {
    diagnostic,
    stage: diagnostic.stage,
    retryable: diagnostic.retryable,
    ...(diagnostic.httpStatus !== undefined ? { upstreamStatus: diagnostic.httpStatus } : {}),
    ...(diagnostic.upstreamRequestId ? { providerRequestId: diagnostic.upstreamRequestId } : {})
  });
}
