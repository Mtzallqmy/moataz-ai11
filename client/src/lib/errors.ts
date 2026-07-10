import { ApiError } from './api';
import type { Language } from './i18n';

type ErrorDetails = {
  stage?: string;
  providerMessage?: string;
  retryable?: boolean;
  reason?: string;
  service?: string;
  upstreamStatus?: number;
};

const ar: Record<string, string> = {
  network_error: 'تعذر الوصول إلى الخادم. تحقق من الاتصال وحاول مجددًا.',
  provider_authentication: 'رفض المزود مفتاح API. تحقق من المفتاح ثم اختبر الاتصال.',
  provider_authorization: 'المفتاح صحيح لكن لا يملك الصلاحية المطلوبة.',
  provider_billing: 'المزود رفض الطلب بسبب الرصيد أو الفوترة.',
  provider_rate_limit: 'تم تجاوز حد الطلبات لدى المزود. حاول بعد قليل.',
  provider_model_not_found: 'النموذج غير موجود أو غير متاح لهذا الحساب.',
  provider_invalid_request: 'إعداد المزود أو اسم النموذج غير صحيح.',
  provider_timeout: 'انتهت مهلة اتصال المزود.',
  provider_network: 'تعذر الاتصال بخادم المزود.',
  provider_service_unavailable: 'خدمة المزود غير متاحة مؤقتًا.',
  provider_unknown: 'أعاد المزود خطأ غير متوقع.',
  provider_empty_response: 'اتصل النظام بالمزود لكنه أعاد ردًا فارغًا.',
  provider_required: 'اختر مزودًا صالحًا لهذه المحادثة أولًا.',
  provider_not_found: 'المزود المحدد غير موجود أو تم حذفه.',
  integration_authentication: 'التوكن غير صحيح أو تم إلغاؤه.',
  integration_authorization: 'التوكن لا يملك الصلاحيات المطلوبة.',
  integration_rate_limit: 'تم تجاوز حد الطلبات في خدمة التكامل.',
  integration_network: 'تعذر الاتصال بخدمة التكامل.',
  integration_service_unavailable: 'خدمة التكامل غير متاحة مؤقتًا.',
  integration_unknown: 'تعذر التحقق من التكامل.',
  telegram_token_invalid_format: 'صيغة توكن Telegram غير صحيحة. انسخ التوكن من BotFather دون أقواس.',
  github_token_invalid_format: 'صيغة توكن GitHub غير صحيحة.',
  integration_not_found: 'التكامل غير موجود أو تم حذفه.',
  shell_unavailable: 'الطرفية معطلة في بيئة الإنتاج لأنها لا تعمل داخل Sandbox خارجي.',
  bad_credentials: 'البريد أو كلمة المرور غير صحيحة.',
  chat_busy: 'توجد عملية جارية في هذه المحادثة. انتظر حتى تكتمل.',
  message_already_processing: 'هذه الرسالة قيد المعالجة بالفعل.',
  rate_limited: 'تم إرسال طلبات كثيرة. حاول بعد قليل.',
  internal_error: 'حدث خطأ داخلي. استخدم رقم الطلب عند التواصل مع الدعم.',
  request_failed: 'فشل الطلب.'
};

const en: Record<string, string> = {
  network_error: 'Could not reach the server. Check your connection and try again.',
  provider_authentication: 'The provider rejected the API key.',
  provider_authorization: 'The key does not have the required permission.',
  provider_billing: 'The provider rejected the request because of credits or billing.',
  provider_rate_limit: 'The provider rate limit was reached.',
  provider_model_not_found: 'The selected model is unavailable or does not exist.',
  provider_invalid_request: 'The provider configuration or model name is invalid.',
  provider_timeout: 'The provider request timed out.',
  provider_network: 'Could not connect to the provider.',
  provider_service_unavailable: 'The provider is temporarily unavailable.',
  provider_unknown: 'The provider returned an unexpected error.',
  provider_empty_response: 'The provider returned an empty response.',
  provider_required: 'Select a valid provider for this conversation.',
  provider_not_found: 'The selected provider is missing or deleted.',
  integration_authentication: 'The integration token is invalid or revoked.',
  integration_authorization: 'The integration token lacks the required permission.',
  integration_rate_limit: 'The integration rate limit was reached.',
  integration_network: 'Could not connect to the integration service.',
  integration_service_unavailable: 'The integration service is temporarily unavailable.',
  integration_unknown: 'Could not validate the integration.',
  telegram_token_invalid_format: 'The Telegram token format is invalid. Copy it from BotFather without brackets.',
  github_token_invalid_format: 'The GitHub token format is invalid.',
  integration_not_found: 'The integration is missing or deleted.',
  shell_unavailable: 'The terminal is disabled in production without an external sandbox.',
  bad_credentials: 'The email or password is incorrect.',
  chat_busy: 'This conversation is currently processing another request.',
  message_already_processing: 'This message is already being processed.',
  rate_limited: 'Too many requests. Try again later.',
  internal_error: 'An internal error occurred. Keep the request ID for support.',
  request_failed: 'The request failed.'
};

function detailsOf(error: ApiError): ErrorDetails {
  return error.details !== null && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details as ErrorDetails
    : {};
}

export function formatError(error: unknown, language: Language): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : String(error);
  const dictionary = language === 'ar' ? ar : en;
  const details = detailsOf(error);
  const base = dictionary[error.code] ?? dictionary.request_failed!;
  const parts = [base];
  if (details.providerMessage && details.providerMessage !== error.code) parts.push(details.providerMessage);
  if (error.requestId) parts.push(language === 'ar' ? `رقم الطلب: ${error.requestId}` : `Request ID: ${error.requestId}`);
  return parts.join('\n');
}

export function errorDetails(error: unknown): ErrorDetails | undefined {
  return error instanceof ApiError ? detailsOf(error) : undefined;
}
