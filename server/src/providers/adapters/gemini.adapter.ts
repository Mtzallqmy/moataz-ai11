import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { AppError } from '../../errors.js';
import type { Msg } from '../../llm-types.js';
import { resolveProviderUrls } from '../base-url.js';
import { providerHttpJson } from '../http.js';
import type {
  DiscoveredModel,
  ModelDiscoveryResult,
  ProviderAdapter,
  ProviderChatInput,
  ProviderChatResult,
  ProviderRuntimeConfig,
  ProviderStreamEvent
} from '../types.js';

const modelsSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    displayName: z.string().optional(),
    inputTokenLimit: z.number().int().positive().optional(),
    supportedGenerationMethods: z.array(z.string()).optional()
  }).passthrough())
}).passthrough();

function normalize(input: ProviderRuntimeConfig): ProviderRuntimeConfig {
  if (!input.apiKey.trim()) throw new AppError('provider_api_key_required', 422, 'A Gemini API key is required.');
  const urls = resolveProviderUrls('gemini', input.rawBaseUrl ?? input.normalizedBaseUrl);
  return { ...input, providerType: 'gemini', rawBaseUrl: urls.rawBaseUrl, normalizedBaseUrl: urls.normalizedBaseUrl };
}

function prompt(messages: readonly Msg[]): string {
  return messages.map((message) => {
    if (message.role === 'tool') return `tool (${message.name}, untrusted output): ${message.content}`;
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return `assistant: ${message.content}\nrequested tools: ${JSON.stringify(message.toolCalls)}`;
    }
    return `${message.role}: ${message.content}`;
  }).join('\n\n');
}

function contentInput(messages: readonly Msg[]): string | Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> {
  const text = prompt(messages);
  const images = messages.flatMap((message) => message.role === 'user' ? [...(message.images ?? [])] : []);
  if (images.length === 0) return text;
  return [
    { text },
    ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.dataBase64 } }))
  ];
}

export class GeminiAdapter implements ProviderAdapter {
  readonly protocol = 'gemini' as const;

  normalizeConfig(input: ProviderRuntimeConfig): ProviderRuntimeConfig {
    return normalize(input);
  }

  async discoverModels(input: ProviderRuntimeConfig, signal?: AbortSignal | undefined): Promise<ModelDiscoveryResult> {
    const config = normalize(input);
    const urls = resolveProviderUrls('gemini', config.normalizedBaseUrl);
    const endpoint = urls.resolvedModelsUrls[0];
    if (!endpoint) return { status: 'unsupported', models: [], testedEndpoints: [], latencyMs: 0, cached: false };
    const url = new URL(endpoint);
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
      testedEndpoints: [endpoint],
      latencyMs: response.latencyMs,
      cached: false
    };
  }

  async createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult> {
    const config = normalize(input.config);
    const model = new GoogleGenerativeAI(config.apiKey).getGenerativeModel({ model: config.model });
    const response = await model.generateContent(
      contentInput(input.messages),
      input.signal ? { signal: input.signal } : undefined
    );
    const text = response.response.text().trim();
    return { text, toolCalls: [], model: config.model };
  }

  async *streamChatCompletion(input: ProviderChatInput): AsyncIterable<ProviderStreamEvent> {
    const config = normalize(input.config);
    const model = new GoogleGenerativeAI(config.apiKey).getGenerativeModel({ model: config.model });
    const result = await model.generateContentStream(contentInput(input.messages));
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield { type: 'text_delta', text };
    }
    yield { type: 'done', model: config.model };
  }
}
