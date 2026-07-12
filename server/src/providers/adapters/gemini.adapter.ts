import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config as appConfig } from '../../config.js';
import { AppError } from '../../errors.js';
import type { Msg } from '../../llm-types.js';
import { resolveProviderUrls } from '../base-url.js';
import { providerHttpJson, providerHttpStream } from '../http.js';
import type {
  DiscoveredModel,
  ModelDiscoveryResult,
  ProviderAdapter,
  ProviderChatInput,
  ProviderChatResult,
  ProviderRuntimeConfig,
  ProviderStreamEvent,
  ProviderToolCall
} from '../types.js';

const modelsSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    displayName: z.string().optional(),
    inputTokenLimit: z.number().int().positive().optional(),
    supportedGenerationMethods: z.array(z.string()).optional()
  }).passthrough())
}).passthrough();

const partSchema = z.object({
  text: z.string().optional(),
  functionCall: z.object({
    name: z.string(),
    args: z.record(z.unknown()).optional()
  }).optional()
}).passthrough();

const responseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(partSchema).optional() }).passthrough().optional()
  }).passthrough()).optional(),
  usageMetadata: z.object({
    promptTokenCount: z.number().int().nonnegative().optional(),
    candidatesTokenCount: z.number().int().nonnegative().optional(),
    totalTokenCount: z.number().int().nonnegative().optional()
  }).passthrough().optional(),
  modelVersion: z.string().optional()
}).passthrough();

function normalize(input: ProviderRuntimeConfig): ProviderRuntimeConfig {
  if (!input.apiKey.trim()) throw new AppError('provider_api_key_required', 422, 'A Gemini API key is required.');
  const urls = resolveProviderUrls('gemini', input.rawBaseUrl ?? input.normalizedBaseUrl);
  return {
    ...input,
    providerType: 'gemini',
    rawBaseUrl: urls.rawBaseUrl,
    normalizedBaseUrl: urls.normalizedBaseUrl
  };
}

function endpoint(config: ProviderRuntimeConfig, operation: 'generateContent' | 'streamGenerateContent'): string {
  const base = config.normalizedBaseUrl?.replace(/\/+$/, '');
  if (!base) throw new AppError('provider_base_url_required', 422);
  const model = config.model.replace(/^models\//, '').trim();
  if (!model) throw new AppError('provider_model_required', 422);
  const url = new URL(`${base}/models/${encodeURIComponent(model)}:${operation}`);
  url.searchParams.set('key', config.apiKey);
  if (operation === 'streamGenerateContent') url.searchParams.set('alt', 'sse');
  return url.toString();
}

function systemInstruction(messages: readonly Msg[]): { parts: Array<{ text: string }> } | undefined {
  const text = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n').trim();
  return text ? { parts: [{ text }] } : undefined;
}

function contents(messages: readonly Msg[]): Array<{ role: 'user' | 'model'; parts: unknown[] }> {
  return messages.flatMap((message): Array<{ role: 'user' | 'model'; parts: unknown[] }> => {
    if (message.role === 'system') return [];
    if (message.role === 'tool') {
      return [{
        role: 'user',
        parts: [{ functionResponse: { name: message.name, response: { content: message.content } } }]
      }];
    }
    if (message.role === 'assistant') {
      const parts: unknown[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.arguments } });
      }
      return [{ role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] }];
    }
    const parts: unknown[] = [{ text: message.content }];
    for (const image of message.images ?? []) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.dataBase64 } });
    }
    return [{ role: 'user', parts }];
  });
}

function requestBody(input: ProviderChatInput): Record<string, unknown> {
  const system = systemInstruction(input.messages);
  return {
    ...(system ? { systemInstruction: system } : {}),
    contents: contents(input.messages),
    generationConfig: {
      temperature: input.temperature ?? 0.3,
      maxOutputTokens: input.maxOutputTokens ?? 3000
    },
    ...(input.tools?.length ? {
      tools: [{
        functionDeclarations: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }))
      }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
    } : {})
  };
}

function parseResult(payload: unknown, fallbackModel: string): ProviderChatResult {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new AppError('provider_invalid_response', 502, 'Gemini returned an invalid response schema.');
  const parts = parsed.data.candidates?.[0]?.content?.parts ?? [];
  const text: string[] = [];
  const toolCalls: ProviderToolCall[] = [];
  for (const part of parts) {
    if (part.text) text.push(part.text);
    if (part.functionCall) {
      toolCalls.push({
        id: `gemini-${randomUUID()}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {}
      });
    }
  }
  const usage = parsed.data.usageMetadata;
  return {
    text: text.join('').trim(),
    toolCalls,
    model: parsed.data.modelVersion ?? fallbackModel,
    ...(usage ? { usage: {
      ...(usage.promptTokenCount !== undefined ? { inputTokens: usage.promptTokenCount } : {}),
      ...(usage.candidatesTokenCount !== undefined ? { outputTokens: usage.candidatesTokenCount } : {}),
      ...(usage.totalTokenCount !== undefined ? { totalTokens: usage.totalTokenCount } : {})
    } } : {})
  };
}

export class GeminiAdapter implements ProviderAdapter {
  readonly protocol = 'gemini' as const;

  normalizeConfig(input: ProviderRuntimeConfig): ProviderRuntimeConfig {
    return normalize(input);
  }

  async discoverModels(input: ProviderRuntimeConfig, signal?: AbortSignal | undefined): Promise<ModelDiscoveryResult> {
    const config = normalize(input);
    const urls = resolveProviderUrls('gemini', config.normalizedBaseUrl);
    const publicEndpoint = urls.resolvedModelsUrls[0];
    if (!publicEndpoint) return { status: 'unsupported', models: [], testedEndpoints: [], latencyMs: 0, cached: false };
    const url = new URL(publicEndpoint);
    url.searchParams.set('key', config.apiKey);
    const response = await providerHttpJson({
      url: url.toString(),
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {})
    });
    const parsed = modelsSchema.safeParse(response.payload);
    if (!parsed.success) throw new AppError('provider_invalid_response', 502, 'Gemini returned an invalid models response.');
    const seen = new Set<string>();
    const models: DiscoveredModel[] = [];
    for (const entry of parsed.data.models) {
      const id = entry.name.replace(/^models\//, '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const methods = entry.supportedGenerationMethods ?? [];
      models.push({
        id,
        ...(entry.displayName ? { name: entry.displayName } : {}),
        ...(entry.inputTokenLimit ? { contextLength: entry.inputTokenLimit } : {}),
        capabilities: {
          chat: methods.includes('generateContent') ? true : null,
          streaming: methods.includes('streamGenerateContent') ? true : null,
          tools: null,
          vision: null,
          embeddings: methods.some((method) => /embed/i.test(method)) ? true : null
        }
      });
    }
    return {
      status: 'supported',
      models,
      testedEndpoints: [publicEndpoint],
      latencyMs: response.latencyMs,
      cached: false
    };
  }

  async createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult> {
    const config = normalize(input.config);
    const response = await providerHttpJson({
      url: endpoint(config, 'generateContent'),
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: requestBody({ ...input, config }),
      ...(input.signal ? { signal: input.signal } : {})
    });
    return {
      ...parseResult(response.payload, config.model),
      ...(response.upstreamRequestId ? { upstreamRequestId: response.upstreamRequestId } : {})
    };
  }

  async *streamChatCompletion(input: ProviderChatInput): AsyncIterable<ProviderStreamEvent> {
    const config = normalize(input.config);
    const transport = await providerHttpStream({
      url: endpoint(config, 'streamGenerateContent'),
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: requestBody({ ...input, config }),
      ...(input.signal ? { signal: input.signal } : {})
    });
    const reader = transport.response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalBytes = 0;
    let model = config.model;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > appConfig.providerMaxResponseBytes) throw new AppError('provider_response_too_large', 413);
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let payload: unknown;
          try { payload = JSON.parse(raw) as unknown; } catch { continue; }
          const result = parseResult(payload, model);
          model = result.model;
          if (result.text) yield { type: 'text_delta', text: result.text };
          for (const call of result.toolCalls) yield { type: 'tool_call', call };
          if (result.usage) yield { type: 'usage', ...result.usage };
        }
      }
      yield {
        type: 'done',
        model,
        ...(transport.upstreamRequestId ? { upstreamRequestId: transport.upstreamRequestId } : {})
      };
    } finally {
      reader.releaseLock();
      transport.dispose();
    }
  }
}
