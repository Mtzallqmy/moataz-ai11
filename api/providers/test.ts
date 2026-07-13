import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { providerType, apiKey, baseUrl, model } = req.body;

    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API Key مطلوب' });
    }

    let success = false;
    let message = '';
    let models: string[] = [];

    const normalizedBase = baseUrl?.replace(/\/$/, '') || '';

    if (providerType === 'gemini') {
      // Test Gemini with a tiny request
      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${apiKey}`;
      const testBody = {
        contents: [{ parts: [{ text: "Hi" }] }]
      };

      const testRes = await fetch(testUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testBody),
      });

      success = testRes.ok;
      if (success) {
        message = 'تم الاتصال بنجاح بـ Google Gemini';
        models = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'];
      } else {
        const err = await testRes.json().catch(() => ({}));
        message = err.error?.message || `فشل الاتصال (${testRes.status})`;
      }

    } else {
      // OpenAI-compatible test (list models or small chat)
      const modelsUrl = normalizedBase 
        ? `${normalizedBase}/models` 
        : 'https://api.openai.com/v1/models';

      const modelsRes = await fetch(modelsUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (modelsRes.ok) {
        const data = await modelsRes.json();
        success = true;
        message = 'تم الاتصال بنجاح';
        models = (data.data || []).slice(0, 8).map((m: any) => m.id);
      } else {
        // Fallback to small chat completion test
        const chatUrl = normalizedBase 
          ? `${normalizedBase}/chat/completions` 
          : 'https://api.openai.com/v1/chat/completions';

        const chatRes = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model || 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5,
          }),
        });

        success = chatRes.ok;
        if (success) {
          message = 'تم الاتصال بنجاح (اختبار chat completions)';
        } else {
          const err = await chatRes.json().catch(() => ({}));
          message = err.error?.message || `فشل الاختبار (${chatRes.status})`;
        }
      }
    }

    return res.status(200).json({
      success,
      message,
      models: models.length > 0 ? models : undefined,
      testedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || 'خطأ في الاتصال بالخادم',
    });
  }
}
