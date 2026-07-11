import { z } from 'zod';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';
import type { LLMToolCall, Msg } from '../../llm-types.js';
import { normalizeProviderUrls, customModelDiscoveryCandidates } from '../base-url.js';
import { diagnoseProviderError, diagnosticToAppError, readyDiagnostic, unsupportedDiscoveryDiagnostic } from '../diagnostics.js';
import { providerHttpJson } from '../http.js';
import { getCachedModels, providerModelCacheKey, setCachedModels } from '../model-cache.js';
import type {
  DiscoveredModel,
  ModelDiscoveryResult,
  NormalizedProviderConfig,
  ProviderAdapter,
  ProviderChatInput,
  ProviderChatResult,
  ProviderDefinition,
  ProviderDiagnosticResult
} from '../types.js';

const modelObjectSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  owned_by: z.string().optional(),
  ownedBy: z.string().optional(),
  context_length: z.number().int().positive().optional(),
  contextLength: z.number().int().positive().optional()
}).passthrough();

const listSchema = z.object({
  data: z.array(z.union([z.string().min(1), modelObjectSchema])).optional(),
  models: z.array(z.union([z.string().min(1), modelObjectSchema])).optional(),
  items: z.array(z.union([z.string().min(1), modelObjectSchema])).optional()
}).passthrough();

const toolCallSchema = z.object({
  id: z.string().optional(),
  function: z.object({
    name: z.string().min(1),
    arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).optional()
  }).passthrough()
}).passthrough();

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    message: z.object({
      content: z.union([
        z.string(),
        z.array(z.union([
          z.string(),
          z.object({ text: z.string().optional() }).passthrough()
        ]))
      ]).nullable().optional(),
      tool_calls: z.array(toolCallSchema).optional()
    }).passthrough()
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional()
  }).passthrough().optional()
}).passthrough();

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeHeaders(definition: ProviderDefinition, input: Record<string, string> | undefined): Readonly<Record<string, string>> {
  const allowed = new Set(definition.allowedCustomHeaders.map((name) => name.toLowerCase()));
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(input ?? {})) {
    const normalized = name.trim().toLowerCase();
    if (!allowed.has(normalized)) continue;
    if (!value.trim()) continue;
    result[normalized] = value.trim().slice(0, 2000);
  }
  return Object.freeze(result);
}

function parseArguments(value: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return record(parsed);
  } catch {
    throw new AppError('provider_invalid_tool_arguments', 422, 'The provider returned invalid tool arguments.', {
      stage: 'invalid_response', retryable: false
    });
  }
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.flatMap((part): string[] => {
    if (typeof part === 'string') return [part];
    const item = record(part);
    return typeof item.text === 'string' ? [item.text] : [];
  }).join('\n').trim();
}

function toOpenAiMessages(messages: readonly Msg[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, name: message.name, content: message.content };
    }
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

function discoveredModel(value: string | z.infer<typeof modelObjectSchema>): DiscoveredModel | undefined {
  if (typeof value === 'string') return { id: value };
  const id = value.id ?? value.name ?? value.model;
  if (!id) return undefined;
  return {
    id,
    ...(value.name && value.name !== id ? { name: value.name } : {}),
    ...((value.owned_by ?? value.ownedBy) ? { ownedBy: value.owned_by ?? value.ownedBy } : {}),
    ...((value.context_length ?? value.contextLength) ? { contextLength: value.context_length ?? value.contextLength } : {})
  };
}

function parseModels(payload: unknown, allowDirectArray: boolean): DiscoveredModel[] {
  let values: Array<string | z.infer<typeof modelObjectSchema>>;
  if (allowDirectArray && Array.isArray(payload)) {
    values = z.array(z.union([z.string().min(1), modelObjectSchema])).parse(payload);
  } else {
    const parsed = listSchema.parse(payload);
    values = parsed.data ?? parsed.models ?? parsed.items ?? [];
  }
  const byId = new Map<string, DiscoveredModel>();
  for (const value of values) {
    const model = discoveredModel(value);
    if (model && !byId.has(model.id)) byId.set(model.id, model);
  }
  return [...byId.values()].slice(0, 1000);
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly definition: ProviderDefinition;

  constructor(definition: ProviderDefinition) {
    this.definition = definition;
  }

  normalizeConfig(input: {
    apiKey?: string;
    baseUrl?: string | null;
    selectedModel?: string | null;
    customHeaders?: Record<string, string>;
  }): NormalizedProviderConfig {
    const urls = normalizeProviderUrls(this.definition, input.baseUrl);
    const apiKey = input.apiKey?.trim() ?? '';
    if (this.definition.apiKeyRequired && !apiKey) {
      throw new AppError('provider_api_key_required', 422, 'An API key is required for this provider.');
    }
    if (!urls.normalizedBaseUrl || !urls.resolvedChatUrl) {
      throw new AppError('provider_base_url_required', 422, 'A Base URL is required for this provider.');
    }
    return {
      providerType: this.definition.id,
      definition: this.definition,
      apiKey,
      selectedModel: input.selectedModel?.trim() || null,
      customHeaders: normalizeHeaders(this.definition, input.customHeaders),
      ...urls
    };
  }

  async discoverModels(configInput: NormalizedProviderConfig, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ModelDiscoveryResult> {
    const cacheKey = providerModelCacheKey(configInput.providerType, configInput.normalizedBaseUrl, configInput.apiKey);
    if (!options.force) {
      const cached = getCachedModels(cacheKey);
      if (cached) return cached;
    }
    const candidates = this.definition.id === 'custom' && configInput.normalizedBaseUrl
      ? customModelDiscoveryCandidates(configInput.normalizedBaseUrl)
      : configInput.resolvedModelsUrl ? [configInput.resolvedModelsUrl] : [];
    if (candidates.length === 0 || this.definition.capabilities.modelDiscovery === false) {
      const unsupported: ModelDiscoveryResult = {
        status: 'unsupported',
        models: this.definition.modelExamples.map((id) => ({ id })),
        fromCache: false,
        message: 'Model discovery is not exposed by this provider.'
      };
      setCachedModels(cacheKey, unsupported, 60_000);
      return unsupported;
    }

    let lastError: unknown;
    for (const endpoint of candidates) {
      try {
        const response = await providerHttpJson({
          method: 'GET', url: endpoint, config: configInput, signal: options.signal,
          timeoutMs: Math.min(config.llmTimeoutMs, 15_000), maxResponseBytes: 2 * 1024 * 1024
        });
        const models = parseModels(response.payload, this.definition.id === 'custom');
        const result: ModelDiscoveryResult = {
          status: 'supported', models, testedEndpoint: endpoint, httpStatus: response.status,
          ...(response.requestId ? { requestId: response.requestId } : {}),
          latencyMs: response.latencyMs, fromCache: false
        };
        setCachedModels(cacheKey, result);
        return result;
      } catch (error) {
        lastError = error;
        const diagnostic = diagnoseProviderError(error, { testedEndpoint: endpoint });
        if (diagnostic.httpStatus === 404 || diagnostic.httpStatus === 405 || diagnostic.status === 'endpoint_not_found') continue;
        throw error;
      }
    }
    const unsupported: ModelDiscoveryResult = {
      status: 'unsupported', models: this.definition.modelExamples.map((id) => ({ id })),
      testedEndpoint: candidates.at(-1), fromCache: false,
      message: lastError instanceof Error ? lastError.message : 'Model discovery endpoint is unsupported.'
    };
    setCachedModels(cacheKey, unsupported, 60_000);
    return unsupported;
  }

  async testConnection(configInput: NormalizedProviderConfig, selectedModel?: string): Promise<ProviderDiagnosticResult> {
    const model = selectedModel?.trim() || configInput.selectedModel?.trim();
    if (!model) {
      throw new AppError('provider_model_required', 422, 'Select a concrete model before inference testing.');
    }
    let discovery: ModelDiscoveryResult | undefined;
    try {
      discovery = await this.discoverModels(configInput);
    } catch (error) {
      const diagnostic = diagnoseProviderError(error, { testedEndpoint: configInput.resolvedModelsUrl ?? undefined });
      if (diagnostic.status !== 'endpoint_not_found' && diagnostic.status !== 'model_discovery_unsupported') throw error;
    }
    const started = Date.now();
    try {
      const response = await this.createChatCompletion({
        config: configInput,
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        temperature: 0,
        maxTokens: 5
      });
      const diagnostic = readyDiagnostic({
        testedEndpoint: configInput.resolvedChatUrl ?? undefined,
        testedModel: response.model,
        latencyMs: Date.now() - started,
        requestId: response.requestId,
        discoverySucceeded: discovery?.status === 'supported'
      });
      return { ...diagnostic, ...(discovery ? { discovery } : {}) };
    } catch (error) {
      const diagnostic = diagnoseProviderError(error, {
        testedEndpoint: configInput.resolvedChatUrl ?? undefined,
        testedModel: model,
        latencyMs: Date.now() - started,
        discoverySucceeded: discovery?.status === 'supported'
      });
      return { ...diagnostic, ...(discovery ? { discovery } : {}) };
    }
  }

  async createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult> {
    const endpoint = input.config.resolvedChatUrl;
    if (!endpoint) throw new AppError('provider_endpoint_not_found', 422, 'The chat completion endpoint is not configured.');
    try {
      const response = await providerHttpJson({
        method: 'POST', url: endpoint, config: input.config, signal: input.signal,
        timeoutMs: config.llmTimeoutMs, maxResponseBytes: 4 * 1024 * 1024,
        body: {
          model: input.model,
          messages: toOpenAiMessages(input.messages),
          temperature: input.temperature ?? 0.3,
          ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
          stream: false,
          ...(input.tools?.length ? {
            tools: input.tools.map((tool) => ({ type: 'function', function: tool })),
            tool_choice: 'auto'
          } : {})
        }
      });
      const parsed = completionSchema.parse(response.payload);
      const message = parsed.choices[0]!.message;
      const toolCalls: LLMToolCall[] = (message.tool_calls ?? []).map((call, index) => ({
        id: call.id || `tool-${Date.now()}-${index}`,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments)
      }));
      const text = contentText(message.content);
      if (!text && toolCalls.length === 0) {
        throw new AppError('provider_empty_response', 502, 'The provider returned an empty completion.', {
          stage: 'invalid_response', retryable: true
        });
      }
      return {
        text,
        toolCalls,
        model: parsed.model || input.model,
        ...(response.requestId ? { requestId: response.requestId } : {}),
        ...(parsed.usage ? {
          usage: {
            ...(parsed.usage.prompt_tokens !== undefined ? { inputTokens: parsed.usage.prompt_tokens } : {}),
            ...(parsed.usage.completion_tokens !== undefined ? { outputTokens: parsed.usage.completion_tokens } : {}),
            ...(parsed.usage.total_tokens !== undefined ? { totalTokens: parsed.usage.total_tokens } : {})
          }
        } : {})
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw diagnosticToAppError(diagnoseProviderError(new Error('Invalid provider response schema.'), {
          testedEndpoint: endpoint,
          testedModel: input.model
        }));
      }
      throw error;
    }
  }
}

export function modelDiscoveryUnsupported(configInput: NormalizedProviderConfig): ProviderDiagnosticResult {
  return unsupportedDiscoveryDiagnostic({ testedEndpoint: configInput.resolvedModelsUrl ?? undefined });
}
