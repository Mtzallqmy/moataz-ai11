import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';
import type { LLMToolCall, Msg } from '../../llm-types.js';
import { normalizeProviderUrls } from '../base-url.js';
import { diagnoseProviderError, readyDiagnostic } from '../diagnostics.js';
import type {
  ModelDiscoveryResult,
  NormalizedProviderConfig,
  ProviderAdapter,
  ProviderChatInput,
  ProviderChatResult,
  ProviderDefinition,
  ProviderDiagnosticResult
} from '../types.js';

type AnthropicImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function normalizeHeaders(definition: ProviderDefinition, input: Record<string, string> | undefined): Readonly<Record<string, string>> {
  const allowed = new Set(definition.allowedCustomHeaders.map((value) => value.toLowerCase()));
  return Object.freeze(Object.fromEntries(Object.entries(input ?? {}).flatMap(([name, value]) => {
    const normalized = name.toLowerCase().trim();
    return allowed.has(normalized) && value.trim() ? [[normalized, value.trim().slice(0, 2000)]] : [];
  })));
}

function systemText(messages: readonly Msg[]): string {
  return messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n') || 'You are Moataz AI.';
}

function anthropicMessages(messages: readonly Msg[]): Anthropic.MessageParam[] {
  return messages.filter((message) => message.role !== 'system').map((message): Anthropic.MessageParam => {
    if (message.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      return { role: 'assistant', content: (blocks.length ? blocks : message.content) as unknown as Anthropic.MessageParam['content'] };
    }
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content, is_error: false }]
      };
    }
    const blocks: Array<Record<string, unknown>> = [];
    for (const image of message.images ?? []) {
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(image.mimeType)) continue;
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mimeType as AnthropicImageMediaType, data: image.dataBase64 }
      });
    }
    blocks.push({ type: 'text', text: message.content });
    return { role: 'user', content: blocks as unknown as Anthropic.MessageParam['content'] };
  });
}

export class AnthropicAdapter implements ProviderAdapter {
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
    if (!apiKey) throw new AppError('provider_api_key_required', 422, 'An Anthropic API key is required.');
    return {
      providerType: this.definition.id,
      definition: this.definition,
      apiKey,
      selectedModel: input.selectedModel?.trim() || null,
      customHeaders: normalizeHeaders(this.definition, input.customHeaders),
      ...normalizeProviderUrls(this.definition, input.baseUrl)
    };
  }

  async discoverModels(_config: NormalizedProviderConfig): Promise<ModelDiscoveryResult> {
    return {
      status: 'unsupported',
      models: this.definition.modelExamples.map((id) => ({ id })),
      fromCache: false,
      message: 'Model discovery is not enabled for the Anthropic adapter; enter a documented model ID manually.'
    };
  }

  async testConnection(configInput: NormalizedProviderConfig, selectedModel?: string): Promise<ProviderDiagnosticResult> {
    const model = selectedModel?.trim() || configInput.selectedModel?.trim();
    if (!model) throw new AppError('provider_model_required', 422, 'Select an Anthropic model before testing.');
    const started = Date.now();
    try {
      const response = await this.createChatCompletion({
        config: configInput,
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        temperature: 0,
        maxTokens: 5
      });
      return {
        ...readyDiagnostic({
          testedEndpoint: configInput.resolvedChatUrl ?? undefined,
          testedModel: response.model,
          latencyMs: Date.now() - started,
          requestId: response.requestId
        }),
        discovery: await this.discoverModels(configInput)
      };
    } catch (error) {
      return {
        ...diagnoseProviderError(error, {
          testedEndpoint: configInput.resolvedChatUrl ?? undefined,
          testedModel: model,
          latencyMs: Date.now() - started
        }),
        discovery: await this.discoverModels(configInput)
      };
    }
  }

  async createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), config.llmTimeoutMs);
    timer.unref();
    const onAbort = () => controller.abort(input.signal?.reason);
    if (input.signal) {
      if (input.signal.aborted) onAbort();
      else input.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const client = new Anthropic({
        apiKey: input.config.apiKey,
        ...(input.config.normalizedBaseUrl ? { baseURL: input.config.normalizedBaseUrl } : {}),
        ...(Object.keys(input.config.customHeaders).length ? { defaultHeaders: input.config.customHeaders } : {})
      });
      const output = await client.messages.create({
        model: input.model,
        max_tokens: input.maxTokens ?? 3000,
        temperature: input.temperature ?? 0.3,
        system: systemText(input.messages),
        messages: anthropicMessages(input.messages),
        ...(input.tools?.length ? {
          tools: input.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters as unknown as Anthropic.Tool.InputSchema }))
        } : {})
      }, { signal: controller.signal });
      const text = output.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
      const toolCalls: LLMToolCall[] = output.content.flatMap((block): LLMToolCall[] => block.type === 'tool_use'
        ? [{ id: block.id, name: block.name, arguments: block.input !== null && typeof block.input === 'object' && !Array.isArray(block.input) ? block.input as Record<string, unknown> : {} }]
        : []);
      if (!text && toolCalls.length === 0) throw new AppError('provider_empty_response', 502, 'Anthropic returned an empty response.');
      const usage = output.usage ? {
        inputTokens: output.usage.input_tokens,
        outputTokens: output.usage.output_tokens,
        totalTokens: output.usage.input_tokens + output.usage.output_tokens
      } : undefined;
      return {
        text,
        toolCalls,
        model: output.model || input.model,
        ...(output.id ? { requestId: output.id } : {}),
        ...(usage ? { usage } : {})
      };
    } catch (error) {
      throw new AppError('provider_request_failed', 502, error instanceof Error ? error.message : 'Anthropic request failed.', {
        providerError: error,
        stage: 'unknown'
      });
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }
}
