import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';
import type { LLMToolCall, Msg } from '../../llm-types.js';
import { resolveProviderUrls } from '../base-url.js';
import { providerHttpJson, providerHttpStream } from '../http.js';
import { getProviderDefinition } from '../registry.js';
import type {
  DiscoveredModel,
  ModelDiscoveryResult,
  ProviderAdapter,
  ProviderChatInput,
  ProviderChatResult,
  ProviderRuntimeConfig,
  ProviderStreamEvent
} from '../types.js';

const modelObjectSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  model: z.string().optional(),
  owned_by: z.string().optional(),
  ownedBy: z.string().optional(),
  context_length: z.number().int().positive().optional(),
  contextLength: z.number().int().positive().optional()
}).passthrough();
const modelEntrySchema = z.union([z.string(), modelObjectSchema]);
const modelArraySchema = z.array(modelEntrySchema);

const chatResponseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    message: z.object({
      content: z.union([z.string(), z.array(z.unknown()), z.null()]).optional(),
      tool_calls: z.array(z.unknown()).optional()
    }).passthrough()
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional()
  }).passthrough().optional()
}).passthrough();

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function headers(configValue: ProviderRuntimeConfig): Record<string, string> {
  const definition = getProviderDefinition(configValue.providerType);
  const output: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...definition.defaultHeaders
  };
  if (definition.authentication === 'bearer' && configValue.apiKey.trim()) {
    output.Authorization = `Bearer ${configValue.apiKey.trim()}`;
  }
  if (definition.id === 'openrouter') {
    output['HTTP-Referer'] = config.appUrl;
    output['X-Title'] = 'Moataz AI';
  }
  const allowed = new Set(definition.allowedCustomHeaders.map((name) => name.toLowerCase()));
  for (const [name, value] of Object.entries(configValue.customHeaders ?? {})) {
    if (allowed.has(name.toLowerCase()) && value.trim()) output[name] = value.trim().slice(0, 2048);
  }
  return output;
}

function allowPrivate(configValue: ProviderRuntimeConfig): boolean {
  const definition = getProviderDefinition(configValue.providerType);
  return definition.localConnection === 'development-only'
    && (!config.isProduction || config.allowPrivateProviderUrls);
}

function normalized(configValue: ProviderRuntimeConfig): ProviderRuntimeConfig {
  const definition = getProviderDefinition(configValue.providerType);
  if (definition.apiKeyRequired && !configValue.apiKey.trim()) {
    throw new AppError('provider_api_key_required', 422, 'An API key is required for this provider.');
  }
  const urls = resolveProviderUrls(configValue.providerType, configValue.rawBaseUrl ?? configValue.normalizedBaseUrl);
  return {
    ...configValue,
    displayName: configValue.displayName || definition.displayName,
    rawBaseUrl: urls.rawBaseUrl,
    normalizedBaseUrl: urls.normalizedBaseUrl
  };
}

function discoveredModel(value: z.infer<typeof modelEntrySchema>): DiscoveredModel | undefined {
  if (typeof value === 'string') {
    const id = value.trim();
    return id ? { id } : undefined;
  }
  const id = (value.id ?? value.name ?? value.model ?? '').trim();
  if (!id) return undefined;
  const ownedBy = value.owned_by ?? value.ownedBy;
  const contextLength = value.context_length ?? value.contextLength;
  return {
    id,
    ...(value.name && value.name !== id ? { name: value.name } : {}),
    ...(ownedBy ? { ownedBy } : {}),
    ...(contextLength ? { contextLength } : {})
  };
}

function parseModels(payload: unknown, allowDirectArray: boolean): DiscoveredModel[] {
  let rawList: unknown;
  if (Array.isArray(payload)) {
    if (!allowDirectArray) throw new AppError('provider_invalid_response', 502, 'A direct model array is accepted only for custom providers.');
    rawList = payload;
  } else {
    const root = record(payload);
    rawList = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : undefined;
  }
  const parsed = modelArraySchema.safeParse(rawList);
  if (!parsed.success) throw new AppError('provider_invalid_response', 502, 'The models endpoint returned an invalid schema.');
  const seen = new Set<string>();
  const output: DiscoveredModel[] = [];
  for (const entry of parsed.data) {
    const model = discoveredModel(entry);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    output.push(model);
  }
  return output.slice(0, 1000);
}

function openAiMessages(messages: readonly Msg[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) }
        }))
      };
    }
    if (message.role === 'user' && message.images?.length) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: message.content },
          ...message.images.map((image) => ({
            type: 'image_url',
            image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}`, detail: 'auto' }
          }))
        ]
      };
    }
    return { role: message.role, content: message.content };
  });
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.flatMap((part): string[] => {
    if (typeof part === 'string') return [part];
    const item = record(part);
    return typeof item.text === 'string' ? [item.text] : [];
  }).join('\n').trim();
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    throw new AppError('provider_invalid_tool_arguments', 422, 'The provider returned invalid tool arguments.');
  }
  return {};
}

function toolCalls(value: unknown): LLMToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): LLMToolCall[] => {
    const call = record(entry);
    const fn = record(call.function);
    if (typeof fn.name !== 'string' || !fn.name.trim()) return [];
    return [{
      id: typeof call.id === 'string' && call.id ? call.id : `tool-${randomUUID()}`,
      name: fn.name,
      arguments: parseArguments(fn.arguments)
    }];
  });
}

function requestBody(input: ProviderChatInput, stream: boolean): Record<string, unknown> {
  return {
    model: input.config.model,
    messages: openAiMessages(input.messages),
    temperature: input.temperature ?? 0.3,
    max_tokens: input.maxOutputTokens ?? 3000,
    stream,
    ...(input.tools?.length ? {
      tools: input.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters }
      })),
      tool_choice: 'auto'
    } : {})
  };
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly protocol = 'openai-compatible' as const;

  normalizeConfig(input: ProviderRuntimeConfig): ProviderRuntimeConfig {
    return normalized(input);
  }

  async discoverModels(input: ProviderRuntimeConfig, signal?: AbortSignal | undefined): Promise<ModelDiscoveryResult> {
    const configValue = normalized(input);
    const urls = resolveProviderUrls(configValue.providerType, configValue.normalizedBaseUrl);
    const started = performance.now();
    const testedEndpoints: string[] = [];
    let lastError: unknown;
    for (const endpoint of urls.resolvedModelsUrls) {
      testedEndpoints.push(endpoint);
      try {
        const response = await providerHttpJson({
          url: endpoint,
          method: 'GET',
          headers: headers(configValue),
          ...(signal ? { signal } : {}),
          timeoutMs: config.providerDiscoveryTimeoutMs,
          allowPrivate: allowPrivate(configValue)
        });
        return {
          status: 'supported',
          models: parseModels(response.payload, configValue.providerType === 'custom'),
          testedEndpoints,
          latencyMs: Math.max(0, Math.round(performance.now() - started)),
          cached: false
        };
      } catch (error) {
        lastError = error;
        const status = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
        if (status === 404 || status === 405) continue;
        throw error;
      }
    }
    return {
      status: 'unsupported',
      models: [],
      testedEndpoints,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      cached: false,
      message: lastError instanceof Error ? lastError.message : 'Model discovery is unsupported.'
    };
  }

  async createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult> {
    const configValue = normalized(input.config);
    const urls = resolveProviderUrls(configValue.providerType, configValue.normalizedBaseUrl);
    if (!urls.resolvedChatUrl) throw new AppError('provider_endpoint_not_found', 422, 'No chat completion endpoint is configured.');
    const response = await providerHttpJson({
      url: urls.resolvedChatUrl,
      method: 'POST',
      headers: headers(configValue),
      body: requestBody({ ...input, config: configValue }, false),
      ...(input.signal ? { signal: input.signal } : {}),
      allowPrivate: allowPrivate(configValue)
    });
    const parsed = chatResponseSchema.safeParse(response.payload);
    if (!parsed.success) throw new AppError('provider_invalid_response', 502, 'The provider returned an invalid chat response.');
    const message = parsed.data.choices[0]!.message;
    const usage = parsed.data.usage;
    return {
      text: textContent(message.content),
      toolCalls: toolCalls(message.tool_calls),
      model: parsed.data.model ?? configValue.model,
      ...(usage ? { usage: {
        ...(usage.prompt_tokens !== undefined ? { inputTokens: usage.prompt_tokens } : {}),
        ...(usage.completion_tokens !== undefined ? { outputTokens: usage.completion_tokens } : {}),
        ...(usage.total_tokens !== undefined ? { totalTokens: usage.total_tokens } : {})
      } } : {}),
      ...(response.upstreamRequestId ? { upstreamRequestId: response.upstreamRequestId } : {})
    };
  }

  async *streamChatCompletion(input: ProviderChatInput): AsyncIterable<ProviderStreamEvent> {
    const configValue = normalized(input.config);
    const urls = resolveProviderUrls(configValue.providerType, configValue.normalizedBaseUrl);
    if (!urls.resolvedChatUrl) throw new AppError('provider_endpoint_not_found', 422, 'No chat completion endpoint is configured.');
    const transport = await providerHttpStream({
      url: urls.resolvedChatUrl,
      method: 'POST',
      headers: headers(configValue),
      body: requestBody({ ...input, config: configValue }, true),
      ...(input.signal ? { signal: input.signal } : {}),
      allowPrivate: allowPrivate(configValue)
    });
    const reader = transport.response.body!.getReader();
    const decoder = new TextDecoder();
    const calls = new Map<number, { id: string; name: string; argumentsText: string }>();
    let buffer = '';
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > config.providerMaxResponseBytes) throw new AppError('provider_response_too_large', 413);
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let payload: unknown;
          try { payload = JSON.parse(data) as unknown; } catch { continue; }
          const root = record(payload);
          const choice = record(Array.isArray(root.choices) ? root.choices[0] : undefined);
          const delta = record(choice.delta);
          if (typeof delta.content === 'string' && delta.content) yield { type: 'text_delta', text: delta.content };
          if (Array.isArray(delta.tool_calls)) {
            for (const raw of delta.tool_calls) {
              const item = record(raw);
              const index = typeof item.index === 'number' ? item.index : 0;
              const fn = record(item.function);
              const current = calls.get(index) ?? {
                id: typeof item.id === 'string' && item.id ? item.id : `tool-${randomUUID()}`,
                name: '',
                argumentsText: ''
              };
              if (typeof item.id === 'string' && item.id) current.id = item.id;
              if (typeof fn.name === 'string') current.name += fn.name;
              if (typeof fn.arguments === 'string') current.argumentsText += fn.arguments;
              calls.set(index, current);
            }
          }
          const usage = record(root.usage);
          if (Object.keys(usage).length > 0) {
            yield {
              type: 'usage',
              ...(typeof usage.prompt_tokens === 'number' ? { inputTokens: usage.prompt_tokens } : {}),
              ...(typeof usage.completion_tokens === 'number' ? { outputTokens: usage.completion_tokens } : {}),
              ...(typeof usage.total_tokens === 'number' ? { totalTokens: usage.total_tokens } : {})
            };
          }
        }
      }
      for (const call of [...calls.entries()].sort(([a], [b]) => a - b).map(([, value]) => value)) {
        if (!call.name) continue;
        yield { type: 'tool_call', call: { id: call.id, name: call.name, arguments: parseArguments(call.argumentsText) } };
      }
      yield {
        type: 'done',
        model: configValue.model,
        ...(transport.upstreamRequestId ? { upstreamRequestId: transport.upstreamRequestId } : {})
      };
    } finally {
      reader.releaseLock();
      transport.dispose();
    }
  }
}
