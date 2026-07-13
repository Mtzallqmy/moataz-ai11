import type { VercelRequest, VercelResponse } from '@vercel/node';

interface ChatRequest {
  providerType: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { providerType, apiKey, baseUrl, model, messages, stream = false }: ChatRequest = req.body;

    if (!apiKey || !model || !messages?.length) {
      return res.status(400).json({ error: 'Missing required fields: apiKey, model, messages' });
    }

    const normalizedBase = baseUrl?.replace(/\/$/, '') || '';

    // === Real Streaming Support (OpenAI-compatible) ===
    if (stream && providerType !== 'gemini') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const openaiUrl = normalizedBase 
        ? `${normalizedBase}/chat/completions` 
        : 'https://api.openai.com/v1/chat/completions';

      const openaiRes = await fetch(openaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          temperature: 0.7,
        }),
      });

      if (!openaiRes.ok || !openaiRes.body) {
        const errorText = await openaiRes.text();
        res.write(`data: ${JSON.stringify({ error: errorText })}\n\n`);
        res.end();
        return;
      }

      const reader = openaiRes.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {
              // ignore parse errors in stream
            }
          }
        }
      }
      res.end();
      return;
    }

    // === Non-streaming (default) ===
    let responseContent = '';
    let tokens = 0;
      // Google Gemini REST API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      const geminiBody = {
        contents: messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
      };

      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });

      if (!geminiRes.ok) {
        const errorData = await geminiRes.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Gemini error: ${geminiRes.status}`);
      }

      const data = await geminiRes.json();
      responseContent = data.candidates?.[0]?.content?.parts?.[0]?.text || 'لم يتم إرجاع رد.';
      tokens = data.usageMetadata?.totalTokenCount || Math.floor(responseContent.length / 3);

    } else {
      // OpenAI-compatible providers (OpenAI, Groq, DeepSeek, Mistral, Together, NVIDIA NIM, Custom)
      const openaiUrl = normalizedBase 
        ? `${normalizedBase}/chat/completions` 
        : 'https://api.openai.com/v1/chat/completions';

      const openaiBody = {
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content
        })),
        temperature: 0.7,
        max_tokens: 2000,
        stream: false, // We handle streaming on frontend for better UX
      };

      const openaiRes = await fetch(openaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(openaiBody),
      });

      if (!openaiRes.ok) {
        const errorData = await openaiRes.json().catch(() => ({}));
        const message = errorData.error?.message || `API error: ${openaiRes.status}`;
        throw new Error(message);
      }

      const data = await openaiRes.json();
      responseContent = data.choices?.[0]?.message?.content || 'لم يتم إرجاع رد من النموذج.';
      tokens = data.usage?.total_tokens || Math.floor((messages.reduce((a, m) => a + m.content.length, 0) + responseContent.length) / 3.5);
    }

    return res.status(200).json({
      content: responseContent,
      tokens,
      model,
      provider: providerType,
    });

  } catch (error: any) {
    console.error('Chat API Error:', error);
    return res.status(500).json({
      error: error.message || 'حدث خطأ أثناء الاتصال بالمزود',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
