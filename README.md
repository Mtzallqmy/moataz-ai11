<div dir="rtl">

# معتز AI — Moataz AI

منصة وكيل ذكاء اصطناعي مبنية باستخدام **TypeScript وReact وExpress**، وتدعم إدارة مزودي النماذج، المحادثات، أدوات الملفات، تكامل GitHub وTelegram، والمصادقة الآمنة.

> **حالة المشروع:** يحتوي هذا الإصدار على أعمال التقوية والإصلاح للمرحلتين صفر وواحد. ترحيل قاعدة البيانات الكامل إلى Drizzle/PostgreSQL، والـAgent Loop الإنتاجي المتعدد الخطوات، والـStreaming الرسمي ما تزال ضمن المراحل التالية وليست مكتملة في هذا الإصدار.

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
- إنشاء المحادثات وإرسال الرسائل واختيار المزود والنموذج.
- تكاملات GitHub وTelegram.
- أدوات ملفات مقيدة داخل مساحة عمل المستخدم مع حماية من Path Traversal والروابط الرمزية.
- WebSocket Terminal باستخدام تذكرة قصيرة العمر وأحادية الاستخدام.
- تعطيل Shell افتراضيًا ومنعه في بيئة الإنتاج.
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

لا تضع مفاتيح مزودي الذكاء الاصطناعي أو GitHub أو Telegram داخل المستودع. تُضاف من إعدادات المنصة أو من متغيرات البيئة عند الحاجة.

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

أي مسار مجهول تحت `/api/*` يعيد JSON 404 ولا يُحوّل إلى واجهة SPA.

## الأمان

- لا توجد أسرار حقيقية أو ملفات `.env` داخل المستودع.
- Refresh Tokens تُخزن كـhash وتُدوّر عند الاستخدام.
- مفاتيح المزودات تُشفّر قبل التخزين.
- كل طلب محمي يعيد التحقق من المستخدم ودوره وحالته.
- WebSocket لا يضع JWT طويل العمر في رابط الاتصال.
- عمليات الملفات تمنع المسارات المطلقة، والتجاوز، والملفات السرية، والروابط الرمزية الخارجة.
- Shell مغلق افتراضيًا وغير متاح في الإنتاج في هذه المرحلة.

## حدود الإصدار الحالي

- طبقة PostgreSQL الحالية طبقة توافق مرحلية؛ الانتقال النهائي إلى Drizzle migrations مؤجل للمرحلة الثانية.
- Tool Calling الرسمي لكل مزود، والـStreaming، والإلغاء، وحفظ خطوات Agent Loop مؤجلة للمرحلة الثالثة.
- Shell المحلي ليس Sandbox أمنيًا، ويجب عدم تشغيله في الإنتاج.
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

الإصدار الحالي: **1.2.0**

راجع [`CHANGELOG.md`](CHANGELOG.md) لمعرفة التغييرات، و[`reports/phase-0-1-report-ar.md`](reports/phase-0-1-report-ar.md) لتقرير التنفيذ التفصيلي.

</div>
