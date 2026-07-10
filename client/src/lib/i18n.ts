const dict = {
  ar: {
    login: 'تسجيل الدخول', email: 'البريد', password: 'كلمة المرور', dashboard: 'لوحة التحكم', chat: 'الوكيل', providers: 'المزودات', integrations: 'التكاملات', terminal: 'الطرفية', settings: 'الإعدادات', send: 'إرسال', newChat: 'محادثة جديدة', addProvider: 'إضافة مزود', addIntegration: 'إضافة تكامل', model: 'النموذج', type: 'النوع', apiKey: 'مفتاح API', baseUrl: 'رابط API', name: 'الاسم', welcome: 'مرحباً بك في Moataz AI', hero: 'منصة وكيل ذكي تربط النماذج والملفات وGitHub وTelegram في واجهة واحدة.', save: 'حفظ', tools: 'الأدوات', light: 'نهاري', dark: 'ليلي', language: 'اللغة', message: 'اكتب مهمتك هنا...', theme: 'الثيم', logout: 'تسجيل الخروج', loading: 'جارٍ التحقق من الجلسة…'
  },
  en: {
    login: 'Login', email: 'Email', password: 'Password', dashboard: 'Dashboard', chat: 'Agent', providers: 'Providers', integrations: 'Integrations', terminal: 'Terminal', settings: 'Settings', send: 'Send', newChat: 'New chat', addProvider: 'Add provider', addIntegration: 'Add integration', model: 'Model', type: 'Type', apiKey: 'API key', baseUrl: 'API URL', name: 'Name', welcome: 'Welcome to Moataz AI', hero: 'An AI agent platform connecting models, files, GitHub and Telegram in one interface.', save: 'Save', tools: 'Tools', light: 'Light', dark: 'Dark', language: 'Language', message: 'Write your task here...', theme: 'Theme', logout: 'Logout', loading: 'Checking your session…'
  }
} as const;

export type Language = keyof typeof dict;
export type TranslationKey = keyof typeof dict.en;

export function useT(lang: Language) {
  return (key: TranslationKey): string => dict[lang][key] ?? key;
}
