# تقرير تنفيذ طبقة المزوّدات الموحدة — Moataz AI 1.6.0

تاريخ التنفيذ: 12 يوليو 2026

## 1. السبب الجذري لفشل المزوّدات سابقًا

جرى تتبع المسار كاملًا من `ProvidersPage.tsx` إلى `routes.ts` ثم `llm.ts` والـAdapters وقاعدة البيانات وواجهة الدردشة. الأسباب المؤكدة قبل التعديل موثقة تفصيليًا في `docs/provider-audit-before.md`، وأهمها:

- عدم وجود تعريف صريح لـNaraRouter، واعتماد المزوّد المخصص على تعريف عام لا يضمن الرابط والبروتوكول الصحيحين.
- عدم حفظ `protocol` في قاعدة البيانات، وبالتالي استنتاج الـAdapter من اسم النوع بدل إعداد صريح.
- تطبيع Base URL لم يكن يزيل علامات الاقتباس الخارجية، وكان مسار تكوين endpoint موزعًا على أكثر من موضع.
- اكتشاف النماذج كان يبدأ بـfetch مباشر فقط، دون SDK-first ودون تمييز واضح بين `/models` غير المدعوم والمفتاح غير الصالح.
- إمكانية إدخال أمثلة نماذج ثابتة ضمن fallback لمزوّد مخصص، ما قد يرسل `gpt-*` أو نموذجًا لا يملكه المزود.
- Cache النماذج لم يكن مربوطًا بالمستخدم والمزوّد وإصدار بيانات الاعتماد.
- تصنيف أخطاء الدفع والمفتاح كان موزعًا ومبنيًا جزئيًا على كلمات عامة؛ 403 و429 و404 لم تكن مفصولة بدقة.
- Custom Headers لم تكن محفوظة، ولا يوجد Mask آمن للمفتاح أو `credential_version` لمسح Cache عند التغيير.
- واجهة الدردشة لم تربط كل إرسال صراحةً بـ`providerId + model`، ولم يكن هناك SSE أو إلغاء أو حالة partial/failed.
- لا يوجد سجل آمن لطلبات المزوّدات يوضح endpoint/model/status/latency دون تسجيل الأسرار.

## 2. الملفات التي تم تعديلها

- إعدادات وتوثيق: `.env.example`, `railway.env.example`, `package.json`, `package-lock.json`, `README.md`, `DEPLOYMENT.md`, `CHANGELOG.md`.
- الخادم: `server/src/config.ts`, `db.ts`, `routes.ts`, `llm.ts`, `llm-types.ts`, `providers.ts`, `provider-diagnostics.ts`, `upstream-errors.ts`.
- طبقة المزوّدات: `server/src/providers/types.ts`, `registry.ts`, `base-url.ts`, `diagnostics.ts`, `http.ts`, `index.ts`, `model-cache.ts`، وAdapters الخاصة بـOpenAI-compatible وAnthropic وGemini.
- الواجهة: `client/src/pages/ProvidersPage.tsx`, `ChatPage.tsx`, `types.ts`, `lib/api.ts`, `lib/errors.ts`, `auth/AuthContext.tsx`, `main.tsx`, `chat/message-state.ts`.
- الاختبارات الحالية عُدلت لتغطية السلوك الجديد، وأهمها `server/src/app.integration.test.ts` واختبارات التشخيص والشبكة والمزوّدات والأخطاء.

## 3. الملفات التي تم إنشاؤها

- `server/src/providers/credentials.ts`
- `server/src/providers/headers.ts`
- `server/src/providers/sse.ts`
- `client/src/chat/sse.ts`
- `scripts/diagnose-provider.ts`
- `docs/provider-audit-before.md`
- اختبارات جديدة لـcredentials وheaders وmodel cache وHTTP وSSE وOpenAI-compatible وStreaming الأصلي وواجهة SSE.

## 4. Migrations المنفذة

المشروع يستخدم حاليًا migration runner مدمجًا ومتوافقًا مع PostgreSQL وSQLite داخل `server/src/db.ts` بدل Drizzle غير المكتمل. أضيف migration idempotent باسم `provider-runtime-1.6.0` ويضيف/يضمن:

- حقول `providers.protocol`, `key_last_four`, `custom_headers_enc`, `credential_version`, `streaming_enabled`, `last_error_message`.
- جدول `provider_models` مع Model ID وقدرات النموذج وأوقات الاكتشاف والتحقق.
- جدول `provider_request_logs` لسجل الطلبات الآمن.
- حقل حالة الرسائل لدعم `completed`, `partial`, `failed`.
- فهارس على نماذج المزود وسجلات الطلبات حسب المستخدم/المزود والتاريخ.
- Backfill للبروتوكول في السجلات القديمة وتنظيف قيم placeholder مثل `auto/default/free/latest`.

لا توجد ملفات Drizzle جزئية أو imports غير مثبتة ضمن التنفيذ الجديد.

## 5. طريقة عمل طبقة المزوّدات الجديدة

- `registry.ts` يعرّف النوع والبروتوكول والرابط الافتراضي وقدرات كل مزوّد، ويشمل NaraRouter صراحةً.
- `index.ts` يختار Adapter من `protocol` المحفوظ، لا من بادئة المفتاح.
- `openai-compatible.adapter.ts` ينشئ OpenAI Client مستقلًا لكل طلب مع المفتاح والرابط الحاليين، ويستخدم Chat Completions فقط.
- Anthropic وGemini لهما Adapters أصلية وتحويل رسائل وStreaming مستقل، ولا يمران عبر صيغة OpenAI إلا عند اختيار بوابة OpenAI-compatible صراحةً.
- كل الاستجابات والأخطاء تتحول إلى أنواع Normalized قبل وصولها إلى routes أو الواجهة.
- إعادة المحاولة محصورة في timeout/network/429/5xx مع backoff وRetry-After؛ لا يوجد انتقال تلقائي إلى مزوّد آخر بتكلفة.

## 6. طريقة تطبيع Base URL

الدالة المركزية في `server/src/providers/base-url.ts`:

- تزيل المسافات وعلامات الاقتباس الخارجية المتطابقة.
- تقبل `http` و`https` فقط، مع فرض HTTPS في SaaS production إلا بسياسة محلية صريحة خارج الإنتاج.
- ترفض username/password داخل URL.
- تزيل query وhash والشرطة النهائية.
- تنظف suffix نهائيًا فقط إذا كان `/models` أو `/chat/completions` أو `/responses`.
- لا تضيف `/v1` تلقائيًا ولا تحذفه من المسارات الصحيحة.
- تحفظ بصورة صحيحة أمثلة NaraRouter وOpenRouter وGroq وDeepInfra ذات prefixes المختلفة.

يُبنى endpoint بعد ذلك بإضافة `/models` أو `/chat/completions` مرة واحدة فقط.

## 7. طريقة اكتشاف النماذج

لمزوّدات OpenAI-compatible:

1. `client.models.list()` من OpenAI SDK.
2. fetch مباشر إلى `${baseUrl}/models` مع Bearer والمداخل الإضافية الآمنة.
3. إذا كان `/models` غير مدعوم (`404/405`)، يسمح Model ID اليدوي ويُختبر عبر inference حقيقي.

تُستخرج IDs الفعلية من `{data:[...]}` أو القوائم المحافظة المدعومة، ولا تُضاف نماذج OpenAI افتراضية لمزوّد مخصص. Cache مرتبط بـuserId/providerId/protocol/baseURL/credentialVersion وبصمة المفتاح، ويُمسح عند تدوير المفتاح أو تغيير الرابط/البروتوكول/headers.

## 8. طريقة تفسير أخطاء HTTP

`server/src/providers/diagnostics.ts` يطبق الأولوية: كود المزود الصريح، ثم HTTP status، ثم رسالة المزود، ثم خطأ الشبكة، ثم fallback داخلي. يدعم:

- 400: طلب/parameter غير صالح، وليس مفتاحًا خاطئًا.
- 401: مصادقة أو Bearer مفقود/مرفوض.
- 402 أو payment code صريح فقط: دفع/رصيد.
- 403: forbidden أو model_not_allowed، وليس invalid key تلقائيًا.
- 404: endpoint_not_found أو model_not_found وفق المرحلة والمسار.
- 405 على discovery: اكتشاف غير مدعوم.
- 413: سياق/طلب كبير.
- 429: rate limit أو quota صريحة مع Retry-After.
- 5xx: upstream مؤقت وقابل لإعادة المحاولة.
- timeout/DNS/TLS/abort/malformed JSON/SSE early close بصورة منفصلة.

يُحتفظ بـrequest ID وupstream request ID والتفاصيل المنقحة، دون Authorization أو المفتاح.

## 9. إصلاحات واجهة الإعدادات

واجهة `ProvidersPage.tsx` أصبحت تدعم:

- الاسم والنوع والبروتوكول وBase URL والمفتاح وCustom Headers الآمنة.
- NaraRouter preset بالرابط المطلوب.
- اكتشاف النماذج وعرض Model ID الحقيقي.
- Model ID يدوي عند غياب discovery.
- النموذج الافتراضي وStreaming والحالة والمرحلة وHTTP status وآخر اختبار.
- Mask للمفتاح بدل إعادته، وترك الحقل فارغًا للاحتفاظ بالمفتاح القديم.
- تفاصيل تقنية آمنة قابلة للنسخ دون أسرار.

## 10. إصلاحات واجهة الدردشة

- تحميل نماذج المزود المختار فقط ومسح النموذج القديم عند تغيير المزود.
- كل إرسال يحمل `providerId`, `model`, `message`, `stream` دون API key أو Base URL.
- الخادم يعيد تحميل المزود من قاعدة البيانات ويتحقق من الملكية والحالة وModel ID.
- SSE حقيقي مع مراحل الاتصال/الانتظار/الاستقبال/الاكتمال.
- `AbortController` للإلغاء.
- idempotency key لمنع تكرار رسالة المستخدم عند الإعادة.
- عدم حفظ Assistant فارغ عند الفشل، وحفظ `partial/failed` عند انقطاع البث.
- تجميع `choices[0].delta.content` وtool calls المتدفقة، وعدم كشف reasoning الداخلي.

## 11. حماية مفاتيح API

- المفتاح يُنظف من المسافات/علامات الاقتباس ولا تُستخدم بادئته كإثبات صلاحية.
- المفاتيح وCustom Headers الحساسة تُشفّر بنظام المشروع القائم على AES-256-GCM ومفتاح `ENCRYPTION_KEY`.
- API لا يعيد ciphertext أو plaintext، بل Mask وآخر أربعة محارف فقط.
- Authorization يُبنى في الباكند، ولا يستطيع Custom Header استبداله.
- سجلات الخادم منقحة ولا تحتوي الرسائل الكاملة أو المفاتيح أو Authorization.
- ملكية المزود تُفحص قبل discovery/test/chat.
- حماية SSRF ترفض الشبكات الخاصة وmetadata وتفرض HTTPS في production، وترفض redirects في نقل المزوّدات.
- Ollama/LM Studio/vLLM المحلي يحتاج `ALLOW_LOCAL_AI_PROVIDERS=true` خارج production فقط.

## 12. نتائج الاختبارات

نتيجة الجولة النهائية المحلية:

- Unit: **88/88 ناجحة** في 22 ملف اختبار.
- Integration: **19/19 ناجحة**.
- اختبار تكامل NaraRouter mocked على مستوى HTTP أثبت: تطبيع الرابط، Bearer، discovery لنموذج فعلي، non-streaming، SSE، حفظ الرسائل، idempotency، تشفير المفتاح، تدوير credential version، ومسح Cache دون كشف السر.
- تشغيل النسخة المبنية أعاد:
  - `/api/health`: HTTP 200 و`{"ok":true,"status":"alive"}`.
  - `/api/ready`: HTTP 200 و`{"ready":true,"database":true,"migrations":true}`.

## 13. نتائج build وtypecheck

- `npm install --ignore-scripts --no-audit --no-fund`: نجح، مع تحذير متوقع لأن بيئة التنفيذ Node 22 بينما المشروع يثبت Node 20.
- `npm run lint`: نجح.
- `npm run typecheck`: نجح.
- `npm test`: نجح.
- `npm run test:integration`: نجح.
- `npm run build`: نجح؛ بُنيت واجهة Vite وخادم TypeScript.
- تشغيل `node dist/server/index.js` واختبارات health/readiness: نجح.

## 14. نتيجة اختبار NaraRouter دون كشف المفتاح

- **الاختبار الخارجي الحقيقي لم يُنفذ** لأن `TEST_NARAROUTER_API_KEY` و`PROVIDER_API_KEY` غير موجودين في بيئة التنفيذ. لم يُستخدم المفتاح السابق الظاهر في محادثات قديمة، ويجب تدويره أصلًا.
- الاختبار المتكامل المحلي باستخدام HTTP mock نجح كاملًا، لكنه لا يُعد إثباتًا على حالة حساب NaraRouter الخارجي.
- سكربت `npm run diagnose:provider` اختُبر دون مفتاح: خرج بـ`provider_invalid_configuration` ولم يطبع أي secret pattern.
- لتنفيذ الاختبار الحقيقي الآمن:

```bash
PROVIDER_BASE_URL=https://router.bynara.id/v1 \
PROVIDER_API_KEY="$TEST_NARAROUTER_API_KEY" \
npm run diagnose:provider
```

بعدها يجب تنفيذ نفس المسار من واجهة الموقع بالمفتاح المدور.

## 15. القيود الحقيقية المتبقية

- لم يتوفر مفتاح NaraRouter مدوّر في البيئة، لذلك لا توجد مطالبة بنجاح خارجي حقيقي.
- لم يتوفر Docker executable محليًا، لذلك لم تُبن صورة Docker هنا؛ Workflow الحالي يبنيها على GitHub Actions بعد نجاح lint/types/tests/build.
- البيئة المحلية Node 22 وليست Node 20. فشل تنزيل/تجميع `better-sqlite3` بسبب DNS والمهلة، لذلك استُخدم `node:sqlite` المدمج كـfallback للاختبارات غير الإنتاجية فقط. Railway/PostgreSQL لا يستخدم هذا fallback.
- لم يُنفذ Browser automation فعلي؛ تم اختبار HTTP routes وSSE والحفظ end-to-end عبر Supertest والنقل mocked، وبُنيت واجهة React بنجاح.
- Tool Calling الأصلي لـAnthropic وGemini ليس بنفس اكتمال OpenAI-compatible رغم دعم البث النصي الأصلي.
- منع DNS rebinding على مستوى التطبيق يراجع DNS ويمنع redirects، لكنه ليس بديلًا عن egress firewall أو proxy شبكي يثبت الوجهة في بيئة SaaS عالية الحساسية.
