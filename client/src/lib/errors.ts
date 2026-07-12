import { ApiError } from './api';
import type { Language } from './i18n';
import type { ProviderDiagnostic } from '../types';

export type ErrorDetails = {
  stage?: string;
  providerMessage?: string;
  retryable?: boolean;
  reason?: string;
  service?: string;
  upstreamStatus?: number;
  suggestion?: string;
  diagnostic?: ProviderDiagnostic;
};

const ar: Record<string, string> = {
  network_error: 'تعذر الوصول إلى الخادم. تم الاحتفاظ بجلسة الدخول والمسودة؛ تحقق من الاتصال وحاول مجددًا.',
  provider_authentication: 'رفض المزود مفتاح API. تحقق من المفتاح؛ لن يتم تسجيل خروجك من Moataz AI.',
  provider_authorization: 'المفتاح معروف للمزود لكنه لا يملك صلاحية النموذج أو المورد المطلوب.',
  provider_billing: 'المزود رفض الطلب بسبب الرصيد أو الفوترة. المفتاح قد يكون صحيحًا لكن الحساب يحتاج رصيدًا أو نموذجًا متاحًا.',
  provider_rate_limit: 'تم تجاوز حد الطلبات أو التوكنات لدى المزود. انتظر ثم أعد المحاولة.',
  provider_model_not_found: 'لم ينجح النموذج المحدد. استخدم auto ليكتشف النظام النماذج المتاحة ويجربها فعليًا.',
  provider_invalid_request: 'رفض المزود الرابط أو اسم النموذج أو صيغة الطلب. تحقق من Base URL؛ يمكن لصق المضيف أو مسار API الكامل وسيتم تطبيعه.',
  provider_base_url_invalid: 'عنوان Base URL غير صالح. استخدم عنوان HTTP أو HTTPS عامًا دون بيانات دخول داخله.',
  provider_timeout: 'انتهت مهلة اتصال المزود. الجلسة محفوظة ويمكن إعادة المحاولة.',
  provider_network: 'تعذر الاتصال بخادم المزود. تحقق من Base URL وDNS وTLS وحالة الخدمة.',
  provider_service_unavailable: 'خدمة المزود أعادت خطأ خادم مؤقتًا. حاول لاحقًا أو اختر مزودًا آخر.',
  provider_unknown: 'أعاد المزود خطأ غير متوقع. راجع رسالة المزود ورقم الطلب.',
  provider_empty_response: 'اتصل النظام بالمزود لكنه أعاد ردًا فارغًا.',
  provider_required: 'اختر مزودًا صالحًا لهذه المحادثة أولًا.',
  provider_not_found: 'المزود المحدد غير موجود أو تم حذفه.',
  provider_not_verified: 'يجب اختبار المزوّد بنجاح قبل استخدامه في المحادثة.',
  provider_api_key_required: 'هذا المزوّد يحتاج مفتاح API.',
  provider_base_url_required: 'هذا المزوّد يحتاج رابط Base URL صحيحًا.',
  provider_model_required: 'أدخل اسم النموذج أو استخدم auto.',
  provider_invalid_tool_arguments: 'أعاد المزود استدعاء أداة بمعاملات غير صالحة.',
  agent_iteration_limit: 'توقف الوكيل بعد بلوغ الحد الأقصى لخطوات الأدوات.',
  multi_agent_failed: 'فشل جميع الوكلاء المحددين. افحص المزوّدات أو استخدم وضع Chat/Agent مؤقتًا.',
  attachment_empty: 'الملف المرفق فارغ.',
  attachment_too_large: 'حجم الملف أكبر من الحد المسموح.',
  attachment_not_found: 'الملف غير موجود أو استُخدم سابقًا أو يتبع محادثة أخرى.',
  attachment_invalid_body: 'تعذر قراءة الملف المرفوع.',
  request_too_large: 'حجم الطلب أكبر من الحد المسموح.',
  integration_authentication: 'التوكن غير صحيح أو تم إلغاؤه.',
  integration_authorization: 'التوكن لا يملك الصلاحيات المطلوبة.',
  integration_rate_limit: 'تم تجاوز حد الطلبات في خدمة التكامل.',
  integration_network: 'تعذر الاتصال بخدمة التكامل.',
  integration_service_unavailable: 'خدمة التكامل غير متاحة مؤقتًا.',
  integration_unknown: 'تعذر التحقق من التكامل.',
  telegram_token_invalid_format: 'صيغة توكن Telegram غير صحيحة. انسخ التوكن من BotFather دون أقواس.',
  github_token_invalid_format: 'صيغة توكن GitHub غير صحيحة.',
  integration_not_found: 'التكامل غير موجود أو تم حذفه.',
  telegram_chat_id_required: 'اختر Chat ID مسموحًا لتكامل Telegram.',
  sandbox_base_url_required: 'أدخل رابط خدمة Sandbox الخارجية.',
  sandbox_integration_not_configured: 'أضف تكامل Sandbox خارجيًا وتحقق منه أولًا.',
  sandbox_execution_failed: 'فشل تنفيذ الأمر داخل خدمة Sandbox الخارجية.',
  http_request_failed: 'أعاد الـAPI الخارجي خطأ. راجع حالة HTTP والاستجابة.',
  web_search_integration_not_configured: 'أضف Brave Search أو Tavily واختبر التكامل لتفعيل البحث.',
  web_search_failed: 'فشل البحث على الويب.',
  web_fetch_failed: 'تعذر جلب الصفحة المطلوبة.',
  private_network_url_not_allowed: 'لا يُسمح بالوصول إلى عناوين الشبكات الخاصة أو الداخلية.',
  invalid_url: 'الرابط غير صحيح.',
  confirmation_required: 'تحتاج هذه الأداة إلى تأكيد صريح قبل التنفيذ.',
  shell_unavailable: 'الطرفية تحتاج Sandbox خارجيًا متحققًا؛ وحدة API تعمل دون Sandbox.',
  session_not_found: 'الجلسة غير موجودة أو انتهت بالفعل.',
  bad_credentials: 'البريد أو كلمة المرور غير صحيحة.',
  chat_busy: 'توجد عملية جارية في هذه المحادثة. انتظر حتى تكتمل.',
  message_already_processing: 'هذه الرسالة قيد المعالجة بالفعل.',
  rate_limited: 'تم إرسال طلبات كثيرة. حاول بعد قليل.',
  internal_error: 'حدث خطأ داخلي. تم الاحتفاظ بالجلسة؛ استخدم رقم الطلب عند التواصل مع الدعم.',
  request_failed: 'فشل الطلب.'
};

const en: Record<string, string> = {
  network_error: 'Could not reach the server. Your session and draft were preserved; check the connection and try again.',
  provider_authentication: 'The provider rejected the API key. Your Moataz AI session remains signed in.',
  provider_authorization: 'The key is recognized but lacks access to the requested model or resource.',
  provider_billing: 'The provider rejected the request because of credits or billing. The key may be valid but the account needs credits or an accessible model.',
  provider_rate_limit: 'The provider request or token limit was reached. Wait and retry.',
  provider_model_not_found: 'The configured model did not work. Use auto to discover and probe available models.',
  provider_invalid_request: 'The provider rejected the URL, model, or request format. Check the base URL; hostnames and full API endpoints are normalized.',
  provider_base_url_invalid: 'The base URL is invalid. Use a public HTTP or HTTPS URL without embedded credentials.',
  provider_timeout: 'The provider request timed out. Your session is preserved and the request can be retried.',
  provider_network: 'Could not connect to the provider. Check the base URL, DNS, TLS, and service status.',
  provider_service_unavailable: 'The provider returned a temporary server error. Retry later or choose another provider.',
  provider_unknown: 'The provider returned an unexpected error. Review the provider message and request ID.',
  provider_empty_response: 'The provider returned an empty response.',
  provider_required: 'Select a valid provider for this conversation.',
  provider_not_found: 'The selected provider is missing or deleted.',
  provider_not_verified: 'Test and verify the provider before using it in chat.',
  provider_api_key_required: 'This provider requires an API key.',
  provider_base_url_required: 'This provider requires a valid base URL.',
  provider_model_required: 'Enter a model name or use auto.',
  provider_invalid_tool_arguments: 'The provider returned invalid tool arguments.',
  agent_iteration_limit: 'The agent stopped after reaching the tool iteration limit.',
  multi_agent_failed: 'Every selected agent failed. Diagnose providers or temporarily use Chat/Agent mode.',
  attachment_empty: 'The attachment is empty.',
  attachment_too_large: 'The attachment exceeds the size limit.',
  attachment_not_found: 'The attachment is missing, already used, or belongs to another chat.',
  attachment_invalid_body: 'The uploaded attachment could not be read.',
  request_too_large: 'The request exceeds the allowed size.',
  integration_authentication: 'The integration token is invalid or revoked.',
  integration_authorization: 'The integration token lacks the required permission.',
  integration_rate_limit: 'The integration rate limit was reached.',
  integration_network: 'Could not connect to the integration service.',
  integration_service_unavailable: 'The integration service is temporarily unavailable.',
  integration_unknown: 'Could not validate the integration.',
  telegram_token_invalid_format: 'The Telegram token format is invalid. Copy it from BotFather without brackets.',
  github_token_invalid_format: 'The GitHub token format is invalid.',
  integration_not_found: 'The integration is missing or deleted.',
  telegram_chat_id_required: 'Choose an allowed Telegram chat ID.',
  sandbox_base_url_required: 'Enter the external sandbox service URL.',
  sandbox_integration_not_configured: 'Configure and verify an external sandbox integration first.',
  sandbox_execution_failed: 'The external sandbox failed to execute the command.',
  http_request_failed: 'The external API returned an error. Review the HTTP status and response.',
  web_search_integration_not_configured: 'Configure and verify Brave Search or Tavily to enable web search.',
  web_search_failed: 'The web search failed.',
  web_fetch_failed: 'The requested page could not be fetched.',
  private_network_url_not_allowed: 'Private and internal network addresses are not allowed.',
  invalid_url: 'The URL is invalid.',
  confirmation_required: 'This tool requires explicit confirmation before execution.',
  shell_unavailable: 'The terminal needs a verified external sandbox; the API console works without it.',
  session_not_found: 'The session is missing or already expired.',
  bad_credentials: 'The email or password is incorrect.',
  chat_busy: 'This conversation is currently processing another request.',
  message_already_processing: 'This message is already being processed.',
  rate_limited: 'Too many requests. Try again later.',
  internal_error: 'An internal error occurred. Your session was preserved; keep the request ID for support.',
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
  if (details.suggestion) parts.push(details.suggestion);
  if (details.diagnostic) {
    const diagnosticMessage = language === 'ar'
      ? details.diagnostic.userMessageAr || details.diagnostic.userMessage
      : details.diagnostic.userMessageEn || details.diagnostic.userMessage;
    if (diagnosticMessage) parts.push(diagnosticMessage);
    if (details.diagnostic.technicalMessage) parts.push(details.diagnostic.technicalMessage);
  }
  if (error.requestId) parts.push(language === 'ar' ? `رقم الطلب: ${error.requestId}` : `Request ID: ${error.requestId}`);
  return [...new Set(parts)].join('\n');
}

export function errorDetails(error: unknown): ErrorDetails | undefined {
  return error instanceof ApiError ? detailsOf(error) : undefined;
}
