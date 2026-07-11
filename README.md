<div dir="rtl">

# معتز AI — Moataz AI

منصة وكيل ذكاء اصطناعي مبنية باستخدام **TypeScript وReact وExpress**، وتدعم إدارة مزودي النماذج، المحادثات، أدوات الملفات، تكامل GitHub وTelegram، والمصادقة الآمنة.

> **حالة المشروع:** الإصدار 1.3.0 يضيف منصة مزوّدات موسعة، تحققًا فعليًا، Tool Calling لمزوّدات OpenAI-compatible، أدوات ويب، اكتشاف محادثات Telegram، وSandbox خارجي. ما يزال Streaming والترحيل النهائي إلى Drizzle وحفظ نقاط استئناف الوكيل ضمن المراحل التالية.

## التقنيات المستخدمة

| الجزء | التقنية |
|---|---|
| الواجهة | React 19 + Vite 6 + TypeScript |
| الخادم | Node.js 20 + Express 4 + TypeScript |
| قاعدة البيانات | PostgreSQL/Supabase للإنتاج، وSQLite للتطوير المحلي المؤقت |
| الذكاء الاصطناعي | OpenAI-compatible، Anthropic، Gemini |
| التكاملات | GitHub عبر Octokit وTelegram Bot API |
| الاختبارات | Vitest + Supertest |
| النشر | Docker متعدد المراحل + Railway |

## الإمكانيات الحالية

- تسجيل الدخول وإدارة الجلسات باستخدام Access Token قصير العمر وRefresh Token دوّار داخل Cookie آمنة.
- تشفير مفاتيح مزودي الذكاء الاصطناعي قبل تخزينها.
- إنشاء المحادثات وإرسال الرسائل واختيار المزود والنموذج، مع اشتراط نجاح اختبار المزود قبل الاستخدام.
- مزوّدات أصلية لـOpenAI وAnthropic وGemini، وواجهات OpenAI-compatible تشمل OpenRouter وNVIDIA وHugging Face وGroq وTogether وغيرها، مع رابط مخصص.
- Tool Calling رسمي لمزوّدات OpenAI-compatible وحلقة وكيل محدودة الخطوات وسجل أدوات ظاهر في المحادثة.
- تكاملات GitHub وTelegram وBrave Search وTavily وSandbox خارجي.
- أدوات ملفات مقيدة داخل مساحة عمل المستخدم مع حماية من Path Traversal والروابط الرمزية.
- WebSocket Terminal محلي باستخدام تذكرة قصيرة العمر، وتنفيذ أوامر الإنتاج فقط عبر Sandbox خارجي متحقق منه.
- تعطيل Shell داخل حاوية الإنتاج دائمًا؛ لا تُنفذ الأوامر على خادم Railway نفسه.
- أداة `web_fetch` بحدود حجم ومهلة وحماية من عناوين الشبكات الخاصة، وأداة `web_search` عبر Brave أو Tavily.
- Health وReadiness endpoints مناسبة لـRailway وDocker.
- CORS بقائمة سماح، وHelmet/CSP، وRate Limiting، وسجلات منقحة من الأسرار.

## متطلبات التشغيل

- Node.js **20.x**
- npm
- PostgreSQL أو Supabase عند النشر الإنتاجي
- أدوات بناء native مثل `python3` و`make` و`g++` عند الحاجة إلى بناء `better-sqlite3` محليًا

## التشغيل المحلي

```bash
# 1) تثبيت الاعتماديات
npm ci

# 2) إنشاء ملف البيئة
cp .env.example .env

# 3) تعديل القيم داخل .env ثم تشغيل الترحيلات والفحص
npm run db:migrate
npm run db:check

# 4) تشغيل الواجهة والخادم
npm run dev
```

بعد التشغيل:

- الواجهة: `http://localhost:5173`
- الخادم: `http://localhost:8080`
- فحص الحياة: `http://localhost:8080/api/health`
- فحص الجاهزية: `http://localhost:8080/api/ready`

## أوامر المشروع

```bash
npm run dev               # تشغيل الواجهة والخادم في وضع التطوير
npm run lint              # فحص ESLint
npm run typecheck         # فحص TypeScript للواجهة والخادم
npm test                  # اختبارات الوحدة
npm run test:integration  # اختبارات التكامل
npm run build             # بناء الواجهة والخادم
npm start                 # تشغيل النسخة المبنية
npm run db:generate       # معلومات توليد مخطط المرحلة الحالية
npm run db:migrate        # تطبيق الترحيلات التوافقية
npm run db:check          # فحص الاتصال والترحيلات
```

## متغيرات البيئة الأساسية

انسخ `.env.example` ولا ترفع ملف `.env` الحقيقي إلى GitHub.

```env
NODE_ENV=production
APP_URL=https://YOUR-SERVICE.up.railway.app
CORS_ORIGIN=https://YOUR-SERVICE.up.railway.app

DATABASE_URL=postgresql://USER:PASSWORD@HOST:6543/postgres
DATABASE_SSL_MODE=require

JWT_SECRET=قيمة_عشوائية_قوية_لا_تقل_عن_32_محرفًا
ENCRYPTION_KEY=قيمة_عشوائية_مختلفة_لا_تقل_عن_32_محرفًا

DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=كلمة_مرور_قوية

WORKSPACE_DIR=/app/workspace
TRUST_PROXY=1
ALLOW_SHELL=false
SHELL_SANDBOX_MODE=disabled
TELEGRAM_POLLING=false
```

لا تضع مفاتيح مزودي الذكاء الاصطناعي أو GitHub أو Telegram أو البحث أو Sandbox داخل المستودع أو متغيرات الواجهة. تُضاف من صفحة **المزوّدات** أو **التكاملات** وتُخزن مشفّرة في قاعدة البيانات.

## إعداد المزوّدات

1. افتح **المزوّدات** واختر المزود. سيُملأ Base URL تلقائيًا للمزوّدات المعروفة ويمكن تعديله.
2. أدخل مفتاح API واسم النموذج، أو اضغط **تحميل النماذج** إذا كان المزود يوفر `/models`.
3. احفظ الإعداد؛ ستكون حالته `untested`.
4. اضغط **اختبار الاتصال**. لا تعمل المحادثة أو Telegram إلا عندما تصبح الحالة `verified`.
5. لا يعني التوافق مع OpenAI أن كل مزود يدعم الأدوات؛ المنصة تستخدم Function Calling عندما يعيده المزود وتعرض الخطأ الحقيقي عند عدم الدعم.

## إعداد Telegram

1. أضف `TELEGRAM_POLLING=true` في Railway واستخدم Replica واحدة.
2. أضف تكامل Telegram واحفظه ثم اختبره.
3. يمكن ترك Chat IDs فارغة في البداية؛ سيعمل البوت في وضع الاكتشاف.
4. أرسل `/start` إلى البوت، ثم اضغط **تحديث** في صفحة التكاملات. ستظهر المحادثة المكتشفة ومعرّفها.
5. اضغط **السماح** للمحادثة. سيُحفظ المعرّف ويُعاد اختبار وتشغيل البوت.

الخيار **السماح لجميع المحادثات** متاح لكنه غير موصى به للبوتات العامة.

## التصفح والبحث وSandbox

- `web_fetch` يجلب صفحة عامة مباشرة مع حدود مهلة وحجم وحماية من الشبكات الخاصة.
- `web_search` يحتاج تكامل Brave Search أو Tavily بحالة `verified`.
- الطرفية الإنتاجية تحتاج تكامل **External Sandbox**. التطبيق لا يشغل أوامر داخل حاوية Railway. عقد الخدمة موثق في [`docs/EXTERNAL_SANDBOX.md`](docs/EXTERNAL_SANDBOX.md).

## النشر على Railway

1. أنشئ مشروعًا جديدًا في Railway واختر **Deploy from GitHub repo**.
2. اربط المستودع `Mtzallqmy/moataz-ai11`.
3. سيستخدم Railway ملف `Dockerfile` الموجود في الجذر.
4. أضف متغيرات البيئة السابقة من تبويب **Variables**.
5. استخدم PostgreSQL/Supabase في الإنتاج، ولا تعتمد على SQLite داخل نظام ملفات Railway المؤقت.
6. بعد النشر افحص:

```text
GET /api/health
GET /api/ready
```

تفاصيل إضافية موجودة في [`DEPLOYMENT.md`](DEPLOYMENT.md).

## بنية المجلدات

```text
.
├── client/                    # واجهة React + Vite
│   └── src/
│       ├── auth/              # حالة المصادقة
│       ├── chat/              # منطق رسائل المحادثة
│       ├── lib/               # API والترجمة
│       └── styles/            # التنسيقات
├── server/
│   ├── src/                   # Express، Auth، DB، LLM، Tools، Telegram، Terminal
│   └── test/                  # إعدادات اختبارات الخادم
├── docs/                      # توثيق البروتوكولات
├── scripts/                   # سكربتات التشغيل والبناء
├── data/                      # بيانات التطوير المحلية — الملفات الفعلية مستثناة من Git
├── workspace/                 # مساحة أدوات الملفات — المحتوى الفعلي مستثنى من Git
├── Dockerfile
├── railway.json
├── package.json
└── .env.example
```

## أهم مسارات API

| الطريقة | المسار | الوظيفة |
|---|---|---|
| GET | `/api/health` | فحص حياة العملية |
| GET | `/api/ready` | فحص قاعدة البيانات والترحيلات |
| GET | `/api/system/status` | حالة النظام دون كشف الأسرار |
| POST | `/api/auth/login` | تسجيل الدخول |
| POST | `/api/auth/refresh` | تدوير الجلسة |
| POST | `/api/auth/logout` | تسجيل الخروج |
| GET | `/api/auth/me` | بيانات المستخدم الحالي |
| POST | `/api/auth/ws-ticket` | تذكرة WebSocket قصيرة العمر للمشرف |
| GET | `/api/provider-catalog` | قائمة المزوّدات وروابطها الجاهزة |
| POST | `/api/providers/models` | اكتشاف نماذج إعداد جديد متوافق مع OpenAI |
| GET | `/api/providers/:id/models` | اكتشاف نماذج مزوّد محفوظ |
| POST | `/api/providers/:id/test` | اختبار المزود وتفعيل استخدامه |
| POST | `/api/integrations/:id/test` | اختبار التكامل وتشغيل Telegram عند تفعيله |
| POST | `/api/tools/run` | تشغيل أداة مباشرة مع التأكيد عند الحاجة |

أي مسار مجهول تحت `/api/*` يعيد JSON 404 ولا يُحوّل إلى واجهة SPA.

## الأمان

- لا توجد أسرار حقيقية أو ملفات `.env` داخل المستودع.
- Refresh Tokens تُخزن كـhash وتُدوّر عند الاستخدام.
- مفاتيح المزودات تُشفّر قبل التخزين.
- كل طلب محمي يعيد التحقق من المستخدم ودوره وحالته.
- WebSocket لا يضع JWT طويل العمر في رابط الاتصال.
- عمليات الملفات تمنع المسارات المطلقة، والتجاوز، والملفات السرية، والروابط الرمزية الخارجة.
- Shell داخل التطبيق مغلق في الإنتاج؛ الأوامر الإنتاجية تمر فقط إلى تكامل Sandbox خارجي متحقق منه وبطلب صريح.

## حدود الإصدار الحالي

- طبقة PostgreSQL الحالية طبقة توافق مرحلية؛ الانتقال النهائي إلى Drizzle migrations مؤجل للمرحلة الثانية.
- Tool Calling الرسمي متاح لمزوّدات OpenAI-compatible؛ الأدوات الأصلية لـAnthropic وGemini والـStreaming والإلغاء وحفظ نقاط الاستئناف ما تزال مستقبلية.
- خدمة Sandbox الخارجية ليست جزءًا من هذا المستودع ويجب أن تكون عزلاً أمنيًا حقيقيًا؛ راجع `docs/EXTERNAL_SANDBOX.md`.
- تشغيل Telegram polling على أكثر من Replica يحتاج Webhook أو Leader Election لمنع التكرار.

## التحقق قبل الدمج أو النشر

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

## الإصدار

الإصدار الحالي: **1.3.0**

راجع [`CHANGELOG.md`](CHANGELOG.md) لمعرفة التغييرات، و[`reports/phase-0-1-report-ar.md`](reports/phase-0-1-report-ar.md) لتقرير التنفيذ التفصيلي.

</div>
