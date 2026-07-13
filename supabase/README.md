# Supabase Setup for معتز العلقمي

## 1. إنشاء المشروع
- اذهب إلى supabase.com وأنشئ مشروع جديد.
- انسخ `SUPABASE_URL` و `SUPABASE_ANON_KEY`.

## 2. إنشاء الجداول (SQL Editor)
```sql
create table providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  encrypted_data jsonb,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table providers enable row level security;

create policy "Users can manage their own providers"
on providers for all
using (auth.uid() = user_id);
```

## 3. نشر Edge Function للتشفير
```bash
supabase login
supabase link --project-ref your-project-ref
supabase secrets set ENCRYPTION_KEY=your-very-strong-32-char-key-here
supabase functions deploy encrypt-provider
```

## 4. في الواجهة
استخدم `src/lib/supabase.ts` للاتصال، واستدعِ الـ Edge Function عند حفظ مزود جديد.

هذا يضمن أن المفاتيح لا تُخزن أبداً بشكل نص واضح.
