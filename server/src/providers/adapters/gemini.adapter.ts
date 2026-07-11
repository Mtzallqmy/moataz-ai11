import { GoogleGenerativeAI, type Content, type FunctionDeclaration, type Part } from '@google/generative-ai';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';
import type { LLMToolCall, Msg } from '../../llm-types.js';
import { normalizeProviderUrls } from '../base-url.js';
import { diagnoseProviderError, readyDiagnostic } from '../diagnostics.js';
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

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function geminiContents(messages: readonly Msg[]): Content[] {
  return messages.filter((message) => message.role !== 'system').map((message): Content => {
    if (message.role === 'assistant') {
      const parts: Part[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.arguments } });
      }
      return { role: 'model', parts };
    }
    if (message.role === 'tool') {
      return { role: 'user', parts: [{ functionResponse: { name: message.name, response: { result: message.content } } }] };
    }
    const parts: Part[] = [{ text: message.content }];
    for (const image of message.images ?? []) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.dataBase64 } });
    }
    return { role: 'user', parts };
  });
}

function systemText(messages: readonly Msg[]): string | undefined {
  const value = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n').trim();
  return value || undefined;
}

function modelId(value: unknown): DiscoveredModel | undefined {
  const row = record(value);
  const raw = typeof row.name === 'string' ? row.name : typeof row.id === 'string' ? row.id : undefined;
  if (!raw) return undefined;
  return {
    id: raw.replace(/^models\//, ''),
    ...(typeof row.displayName === 'string' ? { name: row.displayName } : {}),
    ...(typeof row.inputTokenLimit === 'number' ? { contextLength: row.inputTokenLimit } : {})
  };
}

export class GeminiAdapter implements ProviderAdapter {
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
    const apiKey = input.apiKey?.trim() ?? '';
    if (!apiKey) throw new AppError('provider_api_key_required', 422, 'A Google Gemini API key is required.');
    return {
      providerType: this.definition.id,
      definition: this.definition,
      apiKey,
      selectedModel: input.selectedModel?.trim().replace(/^models\//, '') || null,
      customHeaders: Object.freeze({}),
      ...normalizeProviderUrls(this.definition, input.baseUrl)
    };
  }

  async discoverModels(configInput: NormalizedProviderConfig, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ModelDiscoveryResult> {
    const key = providerModelCacheKey(configInput.providerType, configInput.normalizedBaseUrl, configInput.apiKey);
    if (!options.force) {
      const cached = getCachedModels(key);
      if (cached) return cached;
    }
    const endpoint = configInput.resolvedModelsUrl;
    if (!endpoint) return { status: 'unsupported', models: this.definition.modelExamples.map((id) => ({ id })), fromCache: false };
    try {
      const response = await providerHttpJson({
        method: 'GET', url: endpoint, config: configInput, signal: options.signal,
        timeoutMs: Math.min(config.llmTimeoutMs, 15_000), maxResponseBytes: 2 * 1024 * 1024
      });
      const root = record(response.payload);
      const values = Array.isArray(root.models) ? root.models : [];
      const seen = new Set<string>();
      const models = values.flatMap((value): DiscoveredModel[] => {
        const model = modelId(value);
        if (!model || seen.has(model.id)) return [];
        seen.add(model.id);
        return [model];
      });
      const result: ModelDiscoveryResult = {
        status: 'supported', models, testedEndpoint: endpoint, httpStatus: response.status,
        ...(response.requestId ? { requestId: response.requestId } : {}),
        latencyMs: response.latencyMs, fromCache: false
      };
      setCachedModels(key, result);
      return result;
    } catch (error) {
      const diagnostic = diagnoseProviderError(error, { testedEndpoint: endpoint });
      if (diagnostic.status === 'endpoint_not_found') {
        return { status: 'unsupported', models: this.definition.modelExamples.map((id) => ({ id })), testedEndpoint: endpoint, fromCache: false };
      }
      throw error;
    }
  }

  async testConnection(configInput: NormalizedProviderConfig, selectedModel?: string): Promise<ProviderDiagnosticResult> {
    const model = selectedModel?.trim().replace(/^models\//, '') || configInput.selectedModel;
    if (!model) throw new AppError('provider_model_required', 422, 'Select a Gemini model before testing.');
    let discovery: ModelDiscoveryResult | undefined;
    try { discovery = await this.discoverModels(configInput); } catch { discovery = undefined; }
    const started = Date.now();
    try {
      const response = await this.createChatCompletion({
        config: configInput, model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], temperature: 0, maxTokens: 5
      });
      return {
        ...readyDiagnostic({
          testedEndpoint: configInput.normalizedBaseUrl ?? undefined,
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
          testedEndpoint: configInput.normalizedBaseUrl ?? undefined,
          testedModel: model,
          latencyMs: Date.now() - started,
          discoverySucceeded: discovery?.status === 'supported'
        }),
        ...(discovery ? { discovery } : {})
      };
    }
  }

  async createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult> {
    try {
      const client = new GoogleGenerativeAI(input.config.apiKey);
      const declarations: FunctionDeclaration[] = (input.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as FunctionDeclaration['parameters']
      }));
      const model = client.getGenerativeModel({
        model: input.model.replace(/^models\//, ''),
        ...(systemText(input.messages) ? { systemInstruction: systemText(input.messages) } : {}),
        ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {})
      });
      const contents = geminiContents(input.messages);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), config.llmTimeoutMs);
      timer.unref();
      const abort = () => controller.abort(input.signal?.reason);
      if (input.signal) {
        if (input.signal.aborted) abort();
        else input.signal.addEventListener('abort', abort, { once: true });
      }
      try {
        const response = await model.generateContent({
          contents,
          generationConfig: {
            temperature: input.temperature ?? 0.3,
            ...(input.maxTokens !== undefined ? { maxOutputTokens: input.maxTokens } : {})
          }
        }, { signal: controller.signal });
        const result = response.response;
        const text = result.text().trim();
        const calls: LLMToolCall[] = result.functionCalls()?.map((call, index) => ({
          id: `gemini-${Date.now()}-${index}`,
          name: call.name,
          arguments: record(call.args)
        })) ?? [];
        if (!text && calls.length === 0) throw new AppError('provider_empty_response', 502, 'Gemini returned an empty response.');
        const usage = result.usageMetadata ? {
          ...(result.usageMetadata.promptTokenCount !== undefined ? { inputTokens: result.usageMetadata.promptTokenCount } : {}),
          ...(result.usageMetadata.candidatesTokenCount !== undefined ? { outputTokens: result.usageMetadata.candidatesTokenCount } : {}),
          ...(result.usageMetadata.totalTokenCount !== undefined ? { totalTokens: result.usageMetadata.totalTokenCount } : {})
        } : undefined;
        return { text, toolCalls: calls, model: input.model, ...(usage ? { usage } : {}) };
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', abort);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      const diagnostic = diagnoseProviderError(error, { testedModel: input.model });
      throw new AppError(`provider_${diagnostic.status}`, diagnostic.httpStatus ?? 502, diagnostic.message, { diagnostic });
    }
  }
}
