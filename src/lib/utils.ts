import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  }).format(new Date(date))
}

export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export function truncate(str: string, length: number) {
  return str.length > length ? str.substring(0, length) + '...' : str
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Simple encryption for demo (NOT secure for production - use backend)
export function simpleEncrypt(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
}

export function simpleDecrypt(encoded: string): string {
  try {
    return decodeURIComponent(escape(atob(encoded)))
  } catch {
    return ''
  }
}

// Real API call to our backend (Vercel serverless)
export async function sendRealChatRequest(params: {
  providerType: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
}): Promise<{ content: string; tokens: number }> {
  
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      providerType: params.providerType,
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      model: params.model,
      messages: params.messages,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `خطأ في الخادم (${response.status})`);
  }

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error);
  }

  return {
    content: data.content,
    tokens: data.tokens || 0,
  };
}

// Real Streaming Chat (word by word from the model)
export async function sendRealStreamingChat(
  params: {
    providerType: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
  },
  onChunk: (chunk: string) => void
): Promise<{ content: string; tokens: number }> {
  
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...params,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Streaming failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter(line => line.trim() !== '');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        
        if (data === '[DONE]') {
          return { content: fullContent, tokens: Math.floor(fullContent.length / 3.5) + 50 };
        }
        
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            fullContent += parsed.content;
            onChunk(fullContent); // Update UI in real-time
          }
          if (parsed.error) {
            throw new Error(parsed.error);
          }
        } catch (e) {
          // Ignore parse errors in stream chunks
        }
      }
    }
  }

  return { content: fullContent, tokens: Math.floor(fullContent.length / 3.5) + 50 };
}

// Keep the old mock for fallback / demo mode (when no API key)
export async function generateMockResponse(
  prompt: string, 
  provider: string, 
  model: string,
  onChunk?: (chunk: string) => void
): Promise<{ content: string; tokens: number }> {
  const responses = [
    `بناءً على طلبك، إليك تحليل مفصل:\n\nالنقاط الرئيسية التي يمكنني اقتراحها هي:\n1. تحسين تجربة المستخدم من خلال واجهة أكثر سلاسة.\n2. إضافة ميزات الذكاء الاصطناعي التوليدي لتخصيص المحتوى.\n3. التركيز على الأداء والسرعة في التحميل.\n\nهل تريد تفاصيل أكثر عن أي نقطة؟`,
    `شكراً لسؤالك. بعد دراسة السياق، يمكنني القول بأن الحل الأمثل يتضمن استخدام بنية microservices مع تكامل قوي للـ APIs. هذا يسمح بقابلية التوسع العالية وسهولة الصيانة.\n\nالخطوات المقترحة:\n• تصميم قاعدة بيانات مرنة\n• استخدام TypeScript في كل الطبقات\n• تطبيق اختبارات شاملة`,
    `ممتاز! هذا سؤال عميق. النموذج الذي تستخدمه حالياً يدعم السياق الطويل بشكل جيد، مما يجعله مناسباً للمهام المعقدة مثل كتابة الكود أو تحليل المستندات الطويلة.\n\nإذا كنت ترغب، يمكنني مساعدتك في كتابة prompt محسن لهذا النوع من المهام.`,
  ];

  const baseResponse = responses[Math.floor(Math.random() * responses.length)];
  
  let streamed = '';
  const words = baseResponse.split(' ');
  
  for (let i = 0; i < words.length; i++) {
    await sleep(25 + Math.random() * 40);
    streamed += (i > 0 ? ' ' : '') + words[i];
    if (onChunk) onChunk(streamed);
  }

  return {
    content: streamed,
    tokens: Math.floor(prompt.length / 4) + Math.floor(streamed.length / 3.5) + 120,
  };
}


// Mock model discovery
export function getMockModels(providerType: string): string[] {
  const models: Record<string, string[]> = {
    gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'],
    'openai-compatible': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
    anthropic: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229'],
    nvidia: ['meta/llama-3.1-70b-instruct', 'mistralai/mixtral-8x22b-instruct-v0.1'],
    groq: ['llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
    deepseek: ['deepseek-chat', 'deepseek-coder'],
    mistral: ['mistral-large-latest', 'codestral-latest'],
    together: ['meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo'],
    custom: ['custom-model-1', 'your-fine-tuned-model'],
  }
  return models[providerType] || ['default-model']
}
