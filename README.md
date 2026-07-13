# معتز العلقمي | منصة الذكاء الاصطناعي المتكاملة

منصة ويب احترافية عربية RTL كاملة مبنية بـ **React + TypeScript + Vite + Tailwind**.

## ✨ المميزات

- واجهة عربية RTL احترافية + Dark/Light mode + متجاوبة بالكامل
- مصادقة كاملة (تسجيل / دخول / خروج)
- دردشة حقيقية مع نماذج الذكاء الاصطناعي (Gemini + جميع مزودي OpenAI-compatible)
- وضع وكيل (Agent) مع خطوات تنفيذية
- إدارة مزودين + اختبار اتصال حقيقي + اكتشاف نماذج
- تكاملات متقدمة: GitHub + Telegram + **MCP Servers** (Model Context Protocol)
- حفظ المحادثات محلياً + بث مباشر للردود
- جاهز للإنتاج مع Fallback ذكي (Real API → Mock)

## التقنيات المستخدمة

- React 18 + TypeScript + Vite
- Tailwind CSS + Framer Motion + React Router
- Vercel Serverless Functions (`/api`)
- Supabase (جاهز للاستخدام)
- MCP TypeScript SDK (قابل للتوسع)

## التشغيل المحلي

```bash
npm install
npm run dev
```

## النشر على Vercel (موصى به)

### الطريقة السريعة:

1. ارفع المشروع إلى GitHub
2. اربط المستودع بـ [Vercel](https://vercel.com)
3. اضغط **Deploy**

Vercel سيكتشف `vercel.json` تلقائياً وسيعمل التوجيه (SPA) بشكل مثالي.

### متغيرات البيئة الموصى بها في Vercel:

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
# اختياري للمفاتيح الافتراضية
GEMINI_API_KEY=
OPENAI_API_KEY=
```

## إعداد Supabase (للإنتاج الكامل)

1. أنشئ مشروع جديد على [supabase.com](https://supabase.com)
2. نفذ الـ SQL في SQL Editor (موجود في `supabase/README.md`)
3. انشر Edge Function للتشفير:

```bash
supabase functions deploy encrypt-provider
supabase secrets set ENCRYPTION_KEY=your-strong-32-char-key
```

## GitHub Actions (CI/CD)

يوجد ملف `.github/workflows/deploy.yml` جاهز للنشر التلقائي على Vercel عند كل push إلى `main`.

## هيكل المشروع

```
moataz-alalqami/
├── api/                    # Vercel Serverless Functions (Real AI calls)
├── src/
│   ├── pages/              # جميع الصفحات (Landing, Chat, Providers, Integrations...)
│   ├── components/
│   ├── contexts/           # Auth + Theme
│   └── lib/                # utils + supabase client
├── supabase/               # Edge Functions + SQL
├── vercel.json
└── README.md
```

## الأمان

- لا يتم تخزين مفاتيح API في الكود
- Fallback ذكي عند فشل الاتصال
- Edge Function لتشفير المفاتيح (Supabase)
- Row Level Security جاهز

## الخطوات التالية الموصى بها

1. ارفع المشروع إلى GitHub
2. انشره على Vercel
3. أضف Supabase + فعّل Edge Function للتشفير
4. ابدأ بإضافة مزود Gemini أو OpenAI

---

**معتز العلقمي** — منصة الذكاء الاصطناعي العربية الاحترافية

تم بناؤها بعناية لتكون جاهزة للاستخدام اليومي والتوسع.
