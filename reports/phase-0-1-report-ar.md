# تقرير تنفيذ المرحلة صفر والمرحلة الأولى — Moataz AI

**التاريخ:** 2026-07-10  
**الإصدار:** `1.2.0`  
**فرع الأساس:** `baseline/original` — commit `dfb4f24`  
**فرع العمل:** `work/phase-0-1`  
**هدف التشغيل:** Node.js 20.x

## النتيجة التنفيذية

تم تنفيذ المرحلة صفر والمرحلة الأولى على الملفات الحقيقية للمشروع، مع الاحتفاظ بالأصل في commit/فرع مستقل ونسخة ZIP احتياطية. لم يبدأ ترحيل Drizzle أو أي عمل من المرحلة الثانية.

الحالة النهائية التي تم إثباتها فعليًا:

- `npm ci` من نسخة نظيفة على Node.js `v20.20.2`: **نجح**.
- `npm run lint`: **نجح**.
- `npm run typecheck`: **نجح** مع strict TypeScript وبدون `skipLibCheck`.
- `npm test`: **نجح — 8 ملفات، 26 اختبارًا**.
- `npm run test:integration`: **نجح — 11 اختبارًا**.
- `npm run build`: **نجح** للواجهة والخادم.
- `npm audit`: **0 ثغرات معروفة** وقت التسليم.
- تشغيل `dist/server/index.js` على Node 20: **نجح**.
- `/api/health` و`/api/ready` والواجهة وlogin و`/api/auth/me` وrefresh وJSON API 404: **اختُبرت ونجحت**.
- إغلاق الخادم بـ`SIGTERM`: **نجح دون تعليق**.
- CORS في production: الأصل المسموح أعاد 200، والأصل المجهول أعاد 403.
- CSP في production: **مفعّل ومثبت من response headers**.
- shell/terminal في غياب sandbox خارجية: **مغلق ويرجع `shell_unavailable`**.

الاستثناء الوحيد غير المختبر فعليًا هو `docker build` و`docker run`، لأن بيئة التنفيذ لا تحتوي Docker أو Podman أو Buildah أو nerdctl. تم إنشاء Dockerfile متعدد المراحل وفحصه بنيويًا، وتشغيل نفس artifact النهائي مباشرة على Node 20، لكن لا يُدّعى أن الصورة بُنيت داخل هذه البيئة.

---

## 1. ملخص ما تم إصلاحه

### المرحلة صفر

- فُك الأرشيف بعد التحقق من عدم وجود Zip Slip.
- حُفظ الأرشيف الأصلي منفصلًا، وأُنشئ Git repository ثم commit أساس قبل أي تعديل.
- سُجلت شجرة الملفات الأصلية في `reports/baseline/file-tree.txt`.
- سُجلت نتائج الأوامر الأصلية قبل الإصلاح:
  - `npm install`: exit `1` بسبب native build لـ`better-sqlite3` ومحاولة تنزيل Node 22 headers في بيئة محدودة الشبكة.
  - `npm run build:client`: exit `127` لأن التثبيت الأصلي لم يكتمل وبالتالي Vite غير موجود.
  - `npm run build:server`: exit `2` مع أخطاء dependencies/types بعد فشل التثبيت.
  - `npm run build`: exit `127`.
- أضيفت scripts موحدة: `lint`, `typecheck`, `test`, `test:integration`, `build`, `start`, `db:generate`, `db:migrate`, `db:check`.
- أضيف lockfile صالح، `.gitignore`، `.dockerignore`، وCI على Node 20.
- وُحّد الإصدار إلى `1.2.0` في `package.json` و`CHANGELOG.md`.

### TypeScript والبناء

- أضيفت الأنواع الصحيحة لـ`pg` و`better-sqlite3`.
- ثُبت `@types/express` على Express 4 بدل أنواع Express 5.
- صُحح نوع SQLite إلى `Database.Database`.
- أضيف tsconfig صارم للعميل والخادم.
- فُعّل منع `any` الصريح في ESLint.
- لم يُستخدم `skipLibCheck` لإخفاء أخطاء المشروع.

### الخادم وExpress

- فُصل إنشاء Express app في `server/src/app.ts` لتسهيل الاختبار.
- أضيف `trust proxy` مضبوط تلقائيًا إلى `1` في production عند عدم تحديده.
- فُعل Helmet CSP في production.
- أصبح CORS في production fail-closed إلى `CORS_ORIGIN` أو أصل `APP_URL` فقط.
- أضيف API 404 JSON قبل SPA fallback.
- أضيف global error handler برسائل مستقرة وآمنة.
- أضيف request ID وتسجيل JSON structured مع حجب الحقول السرية.
- أضيف graceful shutdown للخادم وقاعدة البيانات وTelegram وWebSocket والعمليات الفرعية.
- أضيفت:
  - `/api/health` للـliveness.
  - `/api/ready` لقاعدة البيانات والمهاجرات.
  - `/api/system/status` للمستخدم المسجل، دون أسرار أو connection strings.

### المصادقة والجلسات

- تطبيع البريد بـ`trim().toLowerCase()` والتحقق منه بـZod.
- رسائل فشل الدخول عامة: `bad_credentials`.
- عدم إعادة أخطاء قاعدة البيانات الخام.
- استخدام bcrypt async.
- إضافة `is_active` و`last_login_at` وفحصهما من قاعدة البيانات لكل جلسة.
- JWT payload typed مع audience/issuer/type ومدة افتراضية 15 دقيقة.
- إضافة refresh tokens عشوائية محفوظة hash في قاعدة البيانات، مع rotation وrevocation.
- تخزين refresh token في `HttpOnly`, `SameSite=Strict`, و`Secure` في production.
- تنفيذ `/api/auth/me` كمصدر حالة الجلسة.
- إنشاء `AuthContext` موحد؛ access token في الذاكرة فقط، مع إزالة token القديم من localStorage.
- عند 401: محاولة refresh مرة واحدة، ثم مسح حالة React والعودة إلى login فورًا عند الفشل.

### WebSocket terminal وshell

- إزالة JWT طويل العمر من query string.
- إضافة `POST /api/auth/ws-ticket` وتذاكر قصيرة العمر، single-use، purpose-bound، ومخزنة hash.
- إعادة فحص المستخدم والدور والحالة من قاعدة البيانات.
- Origin validation، اتصال واحد افتراضيًا لكل مستخدم، idle timeout، maximum session، maximum input، heartbeat، وتنظيف process tree.
- رسائل terminal أصبحت JSON structured.
- توثيق البروتوكول في `docs/terminal-protocol.md`.
- `ALLOW_SHELL=false` افتراضيًا.
- shell غير متاح في production حتى لو طُلب تفعيله؛ لا يُعامل `cwd` كعزل.
- أداة shell ترجع `shell_unavailable` عندما لا توجد sandbox منفصلة.

### أدوات الملفات

- فصل resolve لمسار موجود عن resolve لهدف كتابة جديد.
- التحقق من أقرب parent موجود عبر realpath ثم `path.relative()`.
- رفض `..`، absolute paths، null bytes، symlink traversal، device/FIFO/socket، والملفات غير regular.
- حماية `.env`, `.git`, `.ssh`, credentials/secrets و`node_modules`.
- السماح بـ`package.json` بدل منعه افتراضيًا.
- كتابة ذرّية إلى temp file ثم rename.
- إضافة create directory، delete، move/rename، stat، وrecursive listing بحدود.
- كل النتائج structured JSON.
- كل مستخدم يعمل داخل root مستقل مشتق من user ID.

### الرسائل وtool calls

- رفض الرسائل الفارغة.
- منع إضافة رسالة المستخدم مرتين إلى model context.
- حفظ رسالة المستخدم وبدء agent run داخل transaction توافقية.
- دعم `Idempotency-Key` وفهرس unique مناسب.
- منع أكثر من run متزامن للمحادثة بقفل in-process وفهرس running فريد.
- عدم تحويل tool result إلى user message؛ يستخدم دورًا داخليًا منفصلًا.
- إضافة تحذير صريح بأن نتيجة الأداة untrusted ولا تعدّل system instructions.
- توحيد `ToolCallRecord`؛ API يعيد array دائمًا مع parser للبيانات القديمة string/object.
- حجب token/api key/authorization في arguments/results.
- إصلاح عرض timeline في الواجهة.
- إصلاح optimistic message: temporary ID معروف يُستبدل بدل إضافته مرتين.

### Telegram والتبعيات

- منع الرد للمحادثات غير الموجودة في allowed chat IDs.
- حد طول الرسالة، rate guard بسيط، safe errors، polling error handling، وإغلاق سليم.
- ترقية `node-telegram-bot-api` وVitest لإزالة سلسلة ثغرات قديمة.
- نتيجة `npm audit` النهائية: صفر.

---

## 2. الملفات المعدلة والجديدة

### ملفات معدلة

- `.env.example`
- `CHANGELOG.md`
- `DEPLOYMENT.md`
- `Dockerfile`
- `README.md`
- `client/src/lib/api.ts`
- `client/src/lib/i18n.ts`
- `client/src/main.tsx`
- `client/src/styles/app.css`
- `package.json`
- `server/src/auth.ts`
- `server/src/config.ts`
- `server/src/db.ts`
- `server/src/index.ts`
- `server/src/llm.ts`
- `server/src/routes.ts`
- `server/src/telegram.ts`
- `server/src/terminal.ts`
- `server/src/tools.ts`
- `server/tsconfig.json`

### ملفات جديدة

- `.dockerignore`
- `.gitignore`
- `.github/workflows/ci.yml`
- `package-lock.json`
- `eslint.config.js`
- `vitest.config.ts`
- `vitest.integration.config.ts`
- `client/tsconfig.json`
- `client/src/auth/AuthContext.tsx`
- `client/src/chat/message-state.ts`
- `client/src/chat/message-state.test.ts`
- `server/src/app.ts`
- `server/src/app.integration.test.ts`
- `server/src/auth.test.ts`
- `server/src/config.test.ts`
- `server/src/db-cli.ts`
- `server/src/errors.ts`
- `server/src/logger.ts`
- `server/src/redaction.ts`
- `server/src/redaction.test.ts`
- `server/src/routes.test.ts`
- `server/src/telegram.test.ts`
- `server/src/tool-calls.ts`
- `server/src/tool-calls.test.ts`
- `server/src/tools.test.ts`
- `server/src/validation.ts`
- `server/src/version.ts`
- `server/src/ws-tickets.ts`
- `server/test/unit-setup.ts`
- `server/test/integration-setup.ts`
- `scripts/ensure-runtime-dirs.mjs`
- `docs/terminal-protocol.md`
- `data/.gitkeep`
- `workspace/.gitkeep`
- `reports/baseline/*`
- `reports/phase-0-1-report-ar.md`

---

## 3. المهاجرات المنشأة

لم تُنشأ Drizzle migrations لأن ذلك هو بداية المرحلة الثانية، وقد طُلب التوقف قبلها.

أضيفت migration توافقية مسجلة بالإصدار:

- `phase1-1.2.0`

وتشمل:

- `schema_migrations`
- إضافة/تحديث `users` مع `is_active`, `updated_at`, `last_login_at`.
- إضافة `user_id` و`idempotency_key` إلى `messages`.
- إضافة `user_id`, `error_code`, `started_at`, `completed_at` إلى `agent_runs`.
- إنشاء `workspaces`.
- إنشاء `refresh_tokens`.
- إنشاء `websocket_tickets`.
- فهارس ownership/status/idempotency/expiry، ومنها فهرس يمنع أكثر من agent run بحالة running للمحادثة نفسها.

هذه migration متعمدة كتوافق مرحلي فقط. إنشاء الجداول عند startup والتحويل الساذج لـ`?` ما زالا دينًا تقنيًا يجب إزالته في المرحلة الثانية عند الانتقال إلى Drizzle/PostgreSQL.

---

## 4. أوامر الاختبار المنفذة ونتائجها الفعلية

| الأمر/التحقق | النتيجة |
|---|---|
| `npm ci` من نسخة نظيفة على Node 20.20.2 | نجح، 466 package، audit صفر |
| `npm run lint` | نجح، دون أخطاء |
| `npm run typecheck` | نجح، client + server strict |
| `npm test` | نجح، 8 ملفات و26 اختبارًا |
| `npm run test:integration` | نجح، 11 اختبارًا |
| `npm run build:client` | نجح، Vite production bundle |
| `npm run build:server` | نجح، `dist/server/index.js` |
| `npm run build` | نجح |
| `npm run db:generate` | نجح؛ يوضح أن Drizzle مؤجل للمرحلة الثانية |
| `npm run db:migrate` | نجح على قاعدة فارغة |
| `npm run db:check` | نجح: healthy/ready و`phase1-1.2.0` |
| تشغيل artifact على Node 20 | نجح |
| `/api/health` | 200 |
| `/api/ready` | 200، database/migrations ready |
| frontend `/` | 200 HTML |
| unknown `/api/*` | 404 JSON `api_not_found` |
| login ببريد غير normalized | 200 وتم التطبيع |
| `/api/auth/me` | 200 للمستخدم النشط |
| refresh cookie | HttpOnly ونجح rotation |
| terminal ticket دون sandbox | 503 `shell_unavailable` |
| production allowed origin | 200 مع ACAO الصحيح |
| production unknown origin | 403 `origin_not_allowed` |
| production CSP | موجود في headers |
| `SIGTERM` | shutdown_started ثم shutdown_completed |
| `npm audit` | 0 vulnerabilities |
| `docker build`/`docker run` | لم يُنفذ: لا يوجد Docker-compatible runtime في البيئة |

السجلات النهائية المهمة:

- `reports/clean-npm-ci-background.log`
- `reports/clean-node20-final-verification-v2.log`
- `reports/node20-runtime-http-summary.json`
- `reports/node20-runtime-server.log`
- `reports/production-cors-csp-phase-1.log`
- `reports/db-scripts-phase-1.log`
- `reports/baseline/`

---

## 5. الاختبارات التي أضيفت

### Unit/frontend state

- env validation وproduction secret rules.
- email normalization وJWT verification.
- secret redaction.
- tool call normalization والـlegacy parser.
- message context لا يكرر رسالة المستخدم.
- optimistic frontend message لا تتكرر.
- file create/update/nested directory.
- traversal/absolute/protected path rejection.
- symlink escape rejection.
- max file size.
- cross-user workspace isolation.
- shell unavailable.
- Telegram allowed chat IDs default-deny.

### Integration

- health/readiness.
- login failure العام ونجاح البريد normalized.
- `/api/auth/me`.
- refresh token HttpOnly rotation.
- inactive user rejection.
- non-admin terminal denial.
- admin terminal unavailable دون sandbox.
- expired/single-use WebSocket ticket.
- cross-user provider/chat denial.
- invalid provider عند إنشاء chat.
- empty message rejection.
- file create/read عبر API وpath traversal rejection.
- unknown API JSON 404.

### Runtime manual/automated script

- Node 20 production artifact startup.
- frontend serving.
- login/me/refresh.
- health/ready.
- production CORS/CSP.
- graceful termination.

---

## 6. المشكلات التي تعذر حلها وسببها

1. **اختبار Docker image فعليًا:** لا توجد أوامر Docker/Podman/Buildah/nerdctl في البيئة، ولا صلاحية لإضافة daemon. لذلك لم يُنفذ build/run/healthcheck للصورة نفسها. Dockerfile جاهز، لكن يجب تشغيل الاختبار على CI أو جهاز به Docker قبل اعتماد معيار القبول رقم 6 نهائيًا.
2. **اختبار Supabase/PostgreSQL حقيقي:** لم يُقدم connection string اختبارية، ولا يجوز استخدام أسرار المستخدم. اختُبرت migration على SQLite النظيفة، وتم typecheck لمسار PostgreSQL، لكن لم تُنفذ migration على Supabase فعلية.
3. **اختبارات مزودات/GitHub/Telegram الخارجية:** لم تُستخدم API keys أو bot tokens. تم اختبار validation/authorization والمنطق المحلي فقط، دون اتصال live.
4. **Browser E2E كامل:** لا توجد Playwright/Cypress harness في المشروع الأصلي، والمرحلة الرابعة لم تبدأ. اختُبر منطق optimistic message كوحدة واختُبرت الواجهة المبنية وتقديمها HTTP، لكن لم يُنفذ browser journey كامل.
5. **المرحلتان الثانية والثالثة والرابعة:** مؤجلة عمدًا وفق الطلب، وليست إخفاقًا في هذه الدفعة.

---

## 7. المخاطر الأمنية المتبقية

- طبقة قاعدة البيانات ما زالت compatibility adapter وتستخدم تحويل placeholders لـPostgreSQL؛ يجب استبدالها بـDrizzle repositories في المرحلة الثانية.
- custom provider base URLs لم تحصل بعد على DNS rebinding/redirect SSRF defense الكامل؛ هذا من المرحلة الثالثة.
- agent tool calling ما زال legacy fenced-tool fallback، وليس tool calling رسميًا لكل مزود.
- agent loop ليس بعد النظام الإنتاجي الكامل ذي streaming/cancellation/persisted steps والحدود الشاملة المذكورة في المرحلة الثالثة.
- file workspace عزل منطقي داخل نفس عملية backend؛ لا يساوي container/OS sandbox ولا يفرض quotas على مستوى kernel.
- GitHub/Telegram external side effects ما زالت بحاجة إلى confirmation workflow أوسع وworker منفصل في المراحل التالية.
- لا توجد آلية rotation تلقائية لـ`ENCRYPTION_KEY` أو إعادة تشفير الأسرار الحالية.
- تشغيل Telegram polling في عدة replicas قد يسبب duplicate consumers؛ يجب اختيار webhook أو leader policy لاحقًا.
- يجب اختبار Docker image وSupabase الحقيقيتين قبل production release.

---

## 8. متغيرات البيئة الجديدة/الموحدة

- `NODE_ENV`
- `PORT`
- `APP_URL`
- `JWT_SECRET`
- `JWT_ACCESS_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_SECONDS`
- `ENCRYPTION_KEY`
- `DATABASE_URL`
- `DATABASE_SSL_MODE=disable|require|verify-full`
- `WORKSPACE_DIR`
- `ALLOW_SHELL`
- `SHELL_SANDBOX_MODE=disabled|local-development`
- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`
- `TELEGRAM_POLLING`
- `CORS_ORIGIN`
- `TRUST_PROXY`
- `MAX_MESSAGE_CHARS`
- `MAX_CONTEXT_MESSAGES`
- `MAX_TOOL_ITERATIONS`
- `MAX_FILE_BYTES`
- `MAX_LIST_ENTRIES`
- `MAX_LIST_DEPTH`
- `MAX_TOOL_OUTPUT_BYTES`
- `LLM_TIMEOUT_MS`
- `WS_TICKET_TTL_SECONDS`
- `TERMINAL_MAX_CONNECTIONS_PER_USER`
- `TERMINAL_IDLE_TIMEOUT_MS`
- `TERMINAL_MAX_SESSION_MS`
- `TERMINAL_MAX_INPUT_BYTES`
- `LOG_LEVEL`

القيم النموذجية موجودة في `.env.example` دون أسرار حقيقية.

---

## 9. خطوات التشغيل المحلي

```bash
cp .env.example .env
# عدّل secrets والقيم المحلية
npm ci
npm run db:migrate
npm run db:check
npm run dev
```

للتحقق الكامل:

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm start
```

إعداد shell المحلي الاختياري فقط:

```env
NODE_ENV=development
ALLOW_SHELL=true
SHELL_SANDBOX_MODE=local-development
```

هذا الوضع ليس sandbox، ولا يُستخدم في production.

---

## 10. خطوات Railway/Supabase

1. استخدم Dockerfile أو Node 20.
2. اضبط `NODE_ENV=production`.
3. اضبط `APP_URL` و`CORS_ORIGIN` إلى الدومين العام نفسه أو allowlist دقيقة.
4. أنشئ `JWT_SECRET` و`ENCRYPTION_KEY` مستقلين، كل منهما 32+ character.
5. استخدم Supabase pooler URL في `DATABASE_URL` من backend فقط.
6. اضبط `DATABASE_SSL_MODE=require` أو `verify-full` عند توفر CA صحيحة.
7. اضبط `TRUST_PROXY=1`.
8. أبقِ `ALLOW_SHELL=false` و`SHELL_SANDBOX_MODE=disabled`.
9. نفذ قبل النشر أو ضمن release job:

```bash
npm ci
npm run db:migrate
npm run db:check
npm run build
```

10. بعد النشر تحقق من health/ready/login/me/CORS/API 404 كما هو موضح في `DEPLOYMENT.md`.

مهم: لا ترسل Supabase service-role key إلى frontend. هذا المشروع يحتاج فقط server-side `DATABASE_URL` في هذه المرحلة.

---

## 11. تغييرات API والتوافق

### متوافقة

- login يعيد `accessToken`، مع إبقاء الحقل القديم `token` كطبقة توافق مؤقتة.
- response رسالة chat يحتفظ بالحقل `message` ويضيف `userMessage` عند توفره.
- tool calls تُعاد دائمًا array؛ parser يدعم التخزين القديم string/object.

### تغييرات أمنية مقصودة قد تكون كاسرة

- WebSocket terminal لم يعد يقبل JWT في query؛ يجب طلب ticket من `/api/auth/ws-ticket`.
- shell/terminal غير متاح في production داخل backend container.
- production CORS لم يعد wildcard/open عندما لا تضبط `CORS_ORIGIN`.
- API errors أصبحت codes آمنة بدل provider/database raw messages.
- الأدوات عالية المخاطر تتطلب role/confirmation وفق registry policy.
- unknown `/api/*` يعيد JSON 404 بدل SPA HTML.

---

## 12. حالة معايير قبول المرحلة صفر/الأولى

- التثبيت النظيف، lint، typecheck، tests، build: **محققة**.
- health/ready/login/me/session expiry behavior: **محققة ومختبرة**.
- production CORS/CSP/API 404: **محققة ومختبرة**.
- shell default-off وعدم تشغيله كـsandbox داخل backend: **محقق**.
- file create/path traversal/symlink isolation: **محقق ومختبر**.
- عدم تكرار رسالة المستخدم في السياق والواجهة: **محقق ومختبر**.
- tool calls normalization وعرضها: **محقق للـlegacy compatibility**؛ tool calling الرسمي لكل مزود من المرحلة الثالثة.
- Dockerfile: **مُنشأ**؛ image build/run **غير مثبت داخل هذه البيئة**.
- Drizzle/migrations النهائية وعزل schema الكامل: **لم يبدأ، التزامًا بعدم الانتقال للمرحلة الثانية**.

