# Railway + PostgreSQL/Supabase deployment — v1.6.0

## ما تم اعتماده للإنتاج

- Node.js 20 عبر `Dockerfile` متعدد المراحل.
- PostgreSQL/Supabase إلزامي في `production` وRailway.
- SQLite متاح فقط للتطوير المحلي/الاختبارات، ولا يدخل صورة Railway.
- Railway يفحص `/api/ready` وليس `/api/health`، لذلك لا يصبح النشر Active قبل اتصال قاعدة البيانات واكتمال الترحيلات.
- التطبيق يعمل كمستخدم `node` غير root، ويستخدم `tini` وإغلاقًا منظّمًا عند `SIGTERM`.
- Shell المحلي مغلق في الإنتاج؛ التنفيذ يحتاج Sandbox خارجي معزول.

## متغيرات Railway الإلزامية

```env
NODE_ENV=production
APP_URL=https://YOUR-SERVICE.up.railway.app
CORS_ORIGIN=https://YOUR-SERVICE.up.railway.app
TRUST_PROXY=1

JWT_SECRET=<random value, 32+ characters>
ENCRYPTION_KEY=<different random value, 32+ characters>
JWT_ACCESS_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000

DATABASE_URL=<PostgreSQL/Supabase connection URL>
DATABASE_SSL_MODE=require
DATABASE_POOL_MAX=10
DATABASE_CONNECTION_TIMEOUT_MS=10000
DATABASE_IDLE_TIMEOUT_MS=30000
DATABASE_STATEMENT_TIMEOUT_MS=30000
DATABASE_CONNECT_ATTEMPTS=5

DEFAULT_ADMIN_EMAIL=<admin email>
DEFAULT_ADMIN_PASSWORD=<strong password, 12+ characters>

WORKSPACE_DIR=/app/workspace
ALLOW_SHELL=false
ALLOW_LOCAL_AI_PROVIDERS=false
SHELL_SANDBOX_MODE=disabled
TELEGRAM_POLLING=false
LOG_LEVEL=info
```

لا تضف `PORT` يدويًا إلا عند الحاجة؛ Railway يحقنه تلقائيًا. عند استخدام `DATABASE_SSL_MODE=verify-full` يجب إضافة `DATABASE_SSL_CA` كنص شهادة PEM أو مسار ملف شهادة مركّب داخل الحاوية.

## مزوّدات الذكاء الاصطناعي في الإنتاج

- مفاتيح المزودات لا توضع في Railway Variables عادةً؛ تُدخل من صفحة المزوّدات وتُشفّر بـ`ENCRYPTION_KEY`.
- NaraRouter يستخدم `openai-compatible` مع `https://router.bynara.id/v1`.
- لا تضف `/v1` داخل Adapter أو بعد Base URL؛ التطبيق يبني `/models` و`/chat/completions` من الرابط المخزن.
- لا تُفعّل `ALLOW_LOCAL_AI_PROVIDERS` في Railway؛ Ollama وLM Studio المحليان مخصصان لبيئة موثوقة غير SaaS.
- بعد تدوير `ENCRYPTION_KEY` لا يمكن فك مفاتيح المزودات القديمة تلقائيًا؛ خطط لعملية إعادة تشفير قبل التغيير.

## خطوات النشر

1. ارفع محتويات جذر المشروع إلى المستودع، بحيث يكون `Dockerfile` و`railway.json` في الجذر نفسه.
2. اربط المستودع بخدمة Railway وأنشئ Public Domain.
3. أضف المتغيرات السابقة، ثم نفّذ Deploy جديدًا.
4. راقب السجلات حتى يظهر:

```text
message=database_migrations_ready
message=server_started
mode=application
```

5. افحص:

```text
GET /api/health -> 200
GET /api/ready  -> 200 { ready: true, database: true, migrations: true }
```

## تشخيص الفشل

- **فشل أثناء Build:** استخدم Node 20 وشغّل `npm ci --include=dev && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run build`.
- **Healthcheck يفشل:** افحص `DATABASE_URL` وSSL واتصال Supabase، ثم المتغيرات الإلزامية.
- **configuration_required:** توجد متغيرات ناقصة؛ السجل يعرض أسماء المتغيرات فقط دون أسرار.
- **database_connection_failed أو ECONNREFUSED/ENOTFOUND:** رابط قاعدة البيانات أو الشبكة غير صحيح.
- **CORS 403:** اجعل `APP_URL` و`CORS_ORIGIN` مطابقين للدومين الفعلي مع `https://`.
- **Application failed to respond:** تأكد أن Target Port في Railway يطابق `PORT` الذي حقنته المنصة، ولا تثبته على منفذ مختلف.

## التخزين

المحادثات والمستخدمون والإعدادات تحفظ في PostgreSQL. ملفات `/app/workspace` داخل الحاوية مؤقتة ما لم تركّب Railway Volume أو تستخدم تخزينًا خارجيًا.

## تشخيص NaraRouter أو مزود OpenAI-compatible

نفّذ محليًا بمفتاح مدوّر داخل Environment Variable، ولا تحفظه في ملف أو سجل:

```bash
PROVIDER_BASE_URL=https://router.bynara.id/v1 \
PROVIDER_API_KEY="$TEST_NARAROUTER_API_KEY" \
npm run diagnose:provider
```

ثم اختبر من الواجهة: حفظ المزود، اكتشاف النماذج، اختيار Model ID، اختبار الاتصال، ثم إرسال رسالة ببث SSE. حالة `404/405` من `/models` لا تعني وحدها أن المفتاح غير صالح.
