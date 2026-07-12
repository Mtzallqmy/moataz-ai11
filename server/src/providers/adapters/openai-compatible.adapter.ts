import { normalizeApiKey } from '../credentials.js';
import OpenAI, { type ClientOptions } from 'openai';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';
import type { LLMToolCall, Msg } from '../../llm-types.js';
import { assertSafeOutboundUrl } from '../../network.js';
import { customModelDiscoveryCandidates, normalizeProviderUrls } from '../base-url.js';
import { diagnoseProviderError, diagnosticToAppError, readyDiagnostic, unsupportedDiscoveryDiagnostic } from '../diagnostics.js';
import { normalizeCustomHeaders, providerRequestHeaders } from '../headers.js';
import { providerHttpJson, providerHttpStream } from '../http.js';
import { getCachedModels, providerModelCacheKey, setCachedModels } from '../model-cache.js';
import { parseSseStream } from '../sse.js';
import type {
  DiscoveredModel,
  ModelDiscoveryResult,
  NormalizedProviderConfig,
  ProviderAdapter,
  ProviderChatInput,
  ProviderChatResult,
  ProviderDefinition,
  ProviderDiagnosticResult,
  ProviderStreamEvent
} from '../types.js';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function likelyReasoningModel(model: string): boolean {
  return /(?:^|[-_/])(reason(?:er|ing)?|o1|o3|o4)(?:$|[-_/])|deepseek-reasoner|gpt-5/i.test(model);
}

function safeAnswerText(root: Record<string, unknown>, choice: Record<string, unknown>, message: Record<string, unknown>): string {
  const candidates = [
    message.content,
    message.output_text,
    message.text,
    choice.text,
    root.output_text,
    root.text
  ];
  for (const candidate of candidates) {
    const text = contentText(candidate);
    if (text) return text;
  }
  return '';
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string') return record(value);
  try {
    return record(JSON.parse(value) as unknown);
  } catch {
    throw new AppError('provider_invalid_tool_arguments', 502, 'The provider returned invalid tool arguments.', {
      stage: 'inference', retryable: false
    });
  }
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.flatMap((part): string[] => {
    if (typeof part === 'string') return [part];
    const item = record(part);
    if (typeof item.text === 'string') return [item.text];
    const text = record(item.text);
    return typeof text.value === 'string' ? [text.value] : [];
  }).join('\n').trim();
}


function contentDeltaText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.flatMap((part): string[] => {
    if (typeof part === 'string') return [part];
    const item = record(part);
    if (typeof item.text === 'string') return [item.text];
    const text = record(item.text);
    return typeof text.value === 'string' ? [text.value] : [];
  }).join('');
}

function toOpenAiMessages(messages: readonly Msg[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
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
            type: 'image_url' as const,
            image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}`, detail: 'auto' as const }
          }))
        ]
      };
    }
    return { role: message.role, content: message.content };
  });
}

function discoveredModel(value: unknown): DiscoveredModel | undefined {
  if (typeof value === 'string' && value.trim()) return { id: value.trim(), raw: value };
  const row = record(value);
  const id = [row.id, row.name, row.model].find((item): item is string => typeof item === 'string' && item.trim().length > 0)?.trim();
  if (!id) return undefined;
  const ownedBy = [row.owned_by, row.ownedBy].find((item): item is string => typeof item === 'string' && item.trim().length > 0);
  const contextLength = [row.context_length, row.contextLength].find((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0);
  return {
    id,
    ...(typeof row.name === 'string' && row.name !== id ? { name: row.name } : {}),
    ...(ownedBy ? { ownedBy } : {}),
    ...(contextLength ? { contextLength } : {}),
    raw: value
  };
}

function parseModels(payload: unknown): DiscoveredModel[] {
  const root = record(payload);
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(root.models)
        ? root.models
        : Array.isArray(root.items)
          ? root.items
          : [];
  const unique = new Map<string, DiscoveredModel>();
  for (const value of values) {
    const model = discoveredModel(value);
    if (model && !unique.has(model.id)) unique.set(model.id, model);
  }
  return [...unique.values()].slice(0, 1000);
}

function completionResult(payload: unknown, fallbackModel: string, requestId?: string): ProviderChatResult {
  const root = record(payload);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = record(choices[0]);
  const message = record(first.message);
  const toolValues = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls: LLMToolCall[] = toolValues.flatMap((value, index): LLMToolCall[] => {
    const call = record(value);
    const fn = record(call.function);
    if (typeof fn.name !== 'string' || !fn.name.trim()) return [];
    return [{
      id: typeof call.id === 'string' && call.id ? call.id : `tool-${Date.now()}-${index}`,
      name: fn.name,
      arguments: parseArguments(fn.arguments)
    }];
  });
  const text = safeAnswerText(root, first, message);
  if (!text && toolCalls.length === 0) {
    const reasoningOnly = typeof message.reasoning_content === 'string'
      || typeof message.reasoning === 'string'
      || typeof root.reasoning === 'string';
    throw new AppError(
      reasoningOnly ? 'provider_reasoning_without_final_answer' : 'provider_empty_response',
      502,
      reasoningOnly
        ? 'The provider returned internal reasoning but no user-facing final answer. Increase the output limit or choose a compatible model.'
        : 'The provider returned an empty completion.',
      { stage: 'inference', retryable: reasoningOnly }
    );
  }
  const usage = record(root.usage);
  const inputTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
  const outputTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined;
  const totalTokens = typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined;
  const model = typeof root.model === 'string' && root.model.trim() ? root.model : fallbackModel;
  return {
    text,
    toolCalls,
    model,
    ...(requestId ? { requestId } : {}),
    ...(inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined ? {
      usage: {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {})
      }
    } : {})
  };
}

function clientFor(configInput: NormalizedProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: configInput.apiKey || 'not-required',
    baseURL: configInput.normalizedBaseUrl ?? undefined,
    timeout: config.llmTimeoutMs,
    maxRetries: 0,
    fetch: globalThis.fetch as unknown as NonNullable<ClientOptions['fetch']>,
    defaultHeaders: providerRequestHeaders(
      configInput.definition,
      configInput.apiKey,
      configInput.customHeaders
    )
  });
}

async function validateEndpoint(configInput: NormalizedProviderConfig, endpoint: string): Promise<void> {
  const allowPrivate = configInput.definition.allowLocalNetwork && config.allowLocalAiProviders;
  const url = await assertSafeOutboundUrl(endpoint, allowPrivate);
  if (config.isProduction && url.protocol !== 'https:') {
    throw new AppError('provider_https_required', 422, 'HTTPS is required for provider APIs in production.', {
      stage: 'configuration', retryable: false
    });
  }
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
    userId?: string;
    providerId?: string;
    credentialVersion?: number;
  }): NormalizedProviderConfig {
    const urls = normalizeProviderUrls(this.definition, input.baseUrl);
    const apiKey = normalizeApiKey(input.apiKey);
    if (this.definition.apiKeyRequired && !apiKey) {
      throw new AppError('provider_api_key_required', 422, 'An API key is required for this provider.', {
        stage: 'configuration', retryable: false
      });
    }
    if (!urls.normalizedBaseUrl || !urls.resolvedChatUrl) {
      throw new AppError('provider_base_url_required', 422, 'A Base URL is required for this provider.', {
        stage: 'configuration', retryable: false
      });
    }
    return {
      providerType: this.definition.id,
      protocol: this.definition.protocol,
      definition: this.definition,
      apiKey,
      selectedModel: input.selectedModel?.trim() || null,
      customHeaders: normalizeCustomHeaders(this.definition, input.customHeaders),
      credentialVersion: Math.max(1, input.credentialVersion ?? 1),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...urls
    };
  }

  async discoverModels(configInput: NormalizedProviderConfig, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ModelDiscoveryResult> {
    const cacheKey = providerModelCacheKey(configInput);
    if (!options.force) {
      const cached = getCachedModels(cacheKey);
      if (cached) return cached;
    }
    if (this.definition.capabilities.modelDiscovery === false || !configInput.normalizedBaseUrl) {
      const unsupported: ModelDiscoveryResult = {
        status: 'unsupported', models: [], fromCache: false, method: 'manual',
        message: 'Model discovery is not exposed by this provider.'
      };
      setCachedModels(cacheKey, unsupported, configInput.providerId, 60_000);
      return unsupported;
    }

    const primaryEndpoint = configInput.resolvedModelsUrl;
    if (primaryEndpoint) {
      try {
        await validateEndpoint(configInput, primaryEndpoint);
        const page = await clientFor(configInput).models.list({ signal: options.signal });
        const models = parseModels(page.data);
        const result: ModelDiscoveryResult = {
          status: 'supported', models, testedEndpoint: primaryEndpoint, httpStatus: 200,
          fromCache: false, method: 'sdk'
        };
        setCachedModels(cacheKey, result, configInput.providerId);
        return result;
      } catch (error) {
        const diagnostic = diagnoseProviderError(error, { stage: 'model_discovery', testedEndpoint: primaryEndpoint });
        if (diagnostic.status === 'invalid_api_key' || diagnostic.status === 'forbidden' || diagnostic.status === 'rate_limited') {
          throw diagnosticToAppError(diagnostic);
        }
      }
    }

    const candidates = this.definition.id === 'custom'
      ? customModelDiscoveryCandidates(configInput.normalizedBaseUrl)
      : primaryEndpoint ? [primaryEndpoint] : [];
    let lastDiagnostic: ProviderDiagnosticResult | undefined;
    for (const endpoint of candidates) {
      try {
        const response = await providerHttpJson({
          method: 'GET', url: endpoint, config: configInput, signal: options.signal,
          timeoutMs: Math.min(config.llmTimeoutMs, 20_000), maxResponseBytes: 2 * 1024 * 1024
        });
        const models = parseModels(response.payload);
        const result: ModelDiscoveryResult = {
          status: 'supported', models, testedEndpoint: endpoint, httpStatus: response.status,
          ...(response.requestId ? { requestId: response.requestId } : {}),
          latencyMs: response.latencyMs, fromCache: false, method: 'fetch'
        };
        setCachedModels(cacheKey, result, configInput.providerId);
        return result;
      } catch (error) {
        lastDiagnostic = diagnoseProviderError(error, { stage: 'model_discovery', testedEndpoint: endpoint });
        if (!['endpoint_not_found', 'model_discovery_unsupported'].includes(lastDiagnostic.status)
          && lastDiagnostic.httpStatus !== 404 && lastDiagnostic.httpStatus !== 405) {
          throw diagnosticToAppError(lastDiagnostic);
        }
      }
    }
    const unsupported: ModelDiscoveryResult = {
      status: 'unsupported', models: [], testedEndpoint: candidates.at(-1), fromCache: false, method: 'manual',
      message: lastDiagnostic?.technicalMessage ?? 'The provider does not expose a compatible models endpoint.'
    };
    setCachedModels(cacheKey, unsupported, configInput.providerId, 60_000);
    return unsupported;
  }

  async testConnection(configInput: NormalizedProviderConfig, selectedModel?: string): Promise<ProviderDiagnosticResult> {
    const model = selectedModel?.trim() || configInput.selectedModel?.trim();
    let discovery: ModelDiscoveryResult | undefined;
    try {
      discovery = await this.discoverModels(configInput, { force: true });
    } catch (error) {
      const diagnostic = diagnoseProviderError(error, {
        stage: 'model_discovery', testedEndpoint: configInput.resolvedModelsUrl ?? undefined
      });
      if (diagnostic.status === 'invalid_api_key' || diagnostic.status === 'forbidden' || diagnostic.status === 'rate_limited') {
        return diagnostic;
      }
    }
    if (!model) {
      return {
        ...unsupportedDiscoveryDiagnostic({
          stage: 'model_discovery',
          testedEndpoint: configInput.resolvedModelsUrl ?? undefined,
          discoverySucceeded: discovery?.status === 'supported'
        }),
        ...(discovery ? { discovery } : {})
      };
    }
    const started = Date.now();
    try {
      const reasoningProbe = likelyReasoningModel(model);
      const response = await this.createChatCompletion({
        config: configInput,
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        ...(reasoningProbe ? {} : { temperature: 0 }),
        maxTokens: reasoningProbe ? 512 : 64
      });
      return {
        ...readyDiagnostic({
          stage: 'inference',
          testedEndpoint: configInput.resolvedChatUrl ?? undefined,
          testedModel: response.model,
          latencyMs: Date.now() - started,
          requestId: response.requestId,
          discoverySucceeded: discovery?.status === 'supported'
        }),
        ...(discovery ? { discovery } : {})
      };
    } catch (error) {
      return {
        ...diagnoseProviderError(error, {
          stage: 'inference',
          testedEndpoint: configInput.resolvedChatUrl ?? undefined,
          testedModel: model,
          latencyMs: Date.now() - started,
          discoverySucceeded: discovery?.status === 'supported'
        }),
        ...(discovery ? { discovery } : {})
      };
    }
  }

  async createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult> {
    const endpoint = input.config.resolvedChatUrl;
    if (!endpoint) throw new AppError('provider_endpoint_not_found', 422, 'The chat completion endpoint is not configured.');
    await validateEndpoint(input.config, endpoint);
    try {
      const completion = await clientFor(input.config).chat.completions.create({
        model: input.model,
        messages: toOpenAiMessages(input.messages),
        stream: false,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
        ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
        ...(input.tools?.length ? {
          tools: input.tools.map((tool) => ({ type: 'function' as const, function: tool })),
          tool_choice: 'auto' as const
        } : {})
      }, { signal: input.signal });
      const requestId = typeof record(completion)._request_id === 'string'
        ? record(completion)._request_id as string
        : undefined;
      return completionResult(completion, input.model, requestId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw diagnosticToAppError(diagnoseProviderError(error, {
        stage: 'inference', testedEndpoint: endpoint, testedModel: input.model
      }));
    }
  }

  async *streamChatCompletion(input: ProviderChatInput): AsyncIterable<ProviderStreamEvent> {
    const endpoint = input.config.resolvedChatUrl;
    if (!endpoint) throw new AppError('provider_endpoint_not_found', 422, 'The chat completion endpoint is not configured.');
    const stream = await providerHttpStream({
      method: 'POST', url: endpoint, config: input.config, signal: input.signal,
      timeoutMs: config.llmTimeoutMs, maxResponseBytes: 2 * 1024 * 1024,
      body: {
        model: input.model,
        messages: toOpenAiMessages(input.messages),
        stream: true,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
        ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
        ...(input.tools?.length ? {
          tools: input.tools.map((tool) => ({ type: 'function', function: tool })),
          tool_choice: 'auto'
        } : {})
      }
    });
    const textParts: string[] = [];
    const toolBuffers = new Map<number, { id?: string; name?: string; argumentsText: string }>();
    let sawDone = false;
    let responseModel = input.model;
    let usage: ProviderChatResult['usage'];
    let sawReasoningOnly = false;
    try {
      if (!stream.response.body) throw new AppError('provider_empty_stream', 502, 'The provider returned an empty stream.');
      for await (const message of parseSseStream(stream.response.body)) {
        if (message.data.trim() === '[DONE]') {
          sawDone = true;
          break;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(message.data) as unknown;
        } catch {
          throw new AppError('provider_invalid_stream_json', 502, 'The provider returned malformed JSON inside the stream.', {
            stage: 'streaming', retryable: false
          });
        }
        const root = record(payload);
        if (root.error) {
          throw diagnosticToAppError(diagnoseProviderError(Object.assign(new Error('Provider stream error.'), {
            response: { status: 502, data: payload, headers: stream.response.headers }
          }), { stage: 'streaming', testedEndpoint: endpoint, testedModel: input.model }));
        }
        if (typeof root.model === 'string' && root.model) responseModel = root.model;
        const usageRow = record(root.usage);
        if (Object.keys(usageRow).length > 0) {
          usage = {
            ...(typeof usageRow.prompt_tokens === 'number' ? { inputTokens: usageRow.prompt_tokens } : {}),
            ...(typeof usageRow.completion_tokens === 'number' ? { outputTokens: usageRow.completion_tokens } : {}),
            ...(typeof usageRow.total_tokens === 'number' ? { totalTokens: usageRow.total_tokens } : {})
          };
        }
        const choices = Array.isArray(root.choices) ? root.choices : [];
        for (const choiceValue of choices) {
          const choice = record(choiceValue);
          const delta = record(choice.delta);
          const text = contentDeltaText(delta.content);
          if (text) {
            textParts.push(text);
            yield { type: 'text_delta', text };
          } else if (typeof delta.reasoning_content === 'string' || typeof delta.reasoning === 'string') {
            // Never expose provider-internal reasoning. Track it only so the
            // eventual error explains why no user-facing answer was produced.
            sawReasoningOnly = true;
          }
          const toolDeltas = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
          for (const toolValue of toolDeltas) {
            const tool = record(toolValue);
            const index = typeof tool.index === 'number' ? tool.index : 0;
            const fn = record(tool.function);
            const current = toolBuffers.get(index) ?? { argumentsText: '' };
            if (typeof tool.id === 'string' && tool.id) current.id = tool.id;
            if (typeof fn.name === 'string' && fn.name) current.name = `${current.name ?? ''}${fn.name}`;
            if (typeof fn.arguments === 'string') current.argumentsText += fn.arguments;
            toolBuffers.set(index, current);
            yield {
              type: 'tool_call_delta', index,
              ...(current.id ? { id: current.id } : {}),
              ...(typeof fn.name === 'string' && fn.name ? { name: fn.name } : {}),
              ...(typeof fn.arguments === 'string' ? { argumentsDelta: fn.arguments } : {})
            };
          }
        }
      }
      if (!sawDone) {
        throw new AppError('provider_stream_closed_early', 502, 'The provider closed the stream before [DONE].', {
          stage: 'streaming', retryable: true
        });
      }
      const toolCalls: LLMToolCall[] = [...toolBuffers.entries()].map(([index, value]) => ({
        id: value.id ?? `tool-${Date.now()}-${index}`,
        name: value.name ?? `tool_${index}`,
        arguments: parseArguments(value.argumentsText)
      }));
      for (const call of toolCalls) yield { type: 'tool_call', call };
      const result: ProviderChatResult = {
        text: textParts.join(''),
        toolCalls,
        model: responseModel,
        ...(stream.requestId ? { requestId: stream.requestId } : {}),
        ...(usage ? { usage } : {})
      };
      if (!result.text.trim() && result.toolCalls.length === 0) {
        throw new AppError(
          sawReasoningOnly ? 'provider_reasoning_without_final_answer' : 'provider_empty_response',
          502,
          sawReasoningOnly
            ? 'The provider streamed internal reasoning but no user-facing final answer.'
            : 'The provider returned an empty stream.',
          { stage: 'streaming', retryable: sawReasoningOnly }
        );
      }
      yield { type: 'completed', result };
    } catch (error) {
      const diagnostic = diagnoseProviderError(error, {
        stage: 'streaming', testedEndpoint: endpoint, testedModel: input.model
      });
      yield { type: 'error', diagnostic };
    } finally {
      stream.dispose();
    }
  }
}

export function modelDiscoveryUnsupported(configInput: NormalizedProviderConfig): ProviderDiagnosticResult {
  return unsupportedDiscoveryDiagnostic({ stage: 'model_discovery', testedEndpoint: configInput.resolvedModelsUrl ?? undefined });
}
