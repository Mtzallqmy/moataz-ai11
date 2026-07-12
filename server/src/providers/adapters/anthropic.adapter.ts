import { normalizeApiKey } from '../credentials.js';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';
import type { LLMToolCall, Msg } from '../../llm-types.js';
import { normalizeProviderUrls } from '../base-url.js';
import { diagnoseProviderError, diagnosticToAppError, readyDiagnostic } from '../diagnostics.js';
import { normalizeCustomHeaders } from '../headers.js';
import type {
  ModelDiscoveryResult,
  NormalizedProviderConfig,
  ProviderAdapter,
  ProviderChatInput,
  ProviderChatResult,
  ProviderDefinition,
  ProviderDiagnosticResult,
  ProviderStreamEvent
} from '../types.js';

type AnthropicImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

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
    userId?: string;
    providerId?: string;
    credentialVersion?: number;
  }): NormalizedProviderConfig {
    const apiKey = normalizeApiKey(input.apiKey);
    if (!apiKey) throw new AppError('provider_api_key_required', 422, 'An Anthropic API key is required.');
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
        maxTokens: 64
      });
      return {
        ...readyDiagnostic({
          stage: 'inference',
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
          stage: 'inference',
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
      if (error instanceof AppError) throw error;
      throw diagnosticToAppError(diagnoseProviderError(error, {
        stage: 'inference',
        testedEndpoint: input.config.resolvedChatUrl ?? undefined,
        testedModel: input.model
      }));
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  async *streamChatCompletion(input: ProviderChatInput): AsyncIterable<ProviderStreamEvent> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), config.llmTimeoutMs);
    timer.unref();
    const onAbort = () => controller.abort(input.signal?.reason);
    if (input.signal) {
      if (input.signal.aborted) onAbort();
      else input.signal.addEventListener('abort', onAbort, { once: true });
    }

    const textParts: string[] = [];
    const toolBuffers = new Map<number, { id: string; name: string; argumentsText: string; initial: Record<string, unknown> }>();
    let requestId: string | undefined;
    let responseModel = input.model;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let sawStop = false;

    try {
      const client = new Anthropic({
        apiKey: input.config.apiKey,
        ...(input.config.normalizedBaseUrl ? { baseURL: input.config.normalizedBaseUrl } : {}),
        ...(Object.keys(input.config.customHeaders).length ? { defaultHeaders: input.config.customHeaders } : {})
      });
      const stream = client.messages.stream({
        model: input.model,
        max_tokens: input.maxTokens ?? 3000,
        temperature: input.temperature ?? 0.3,
        system: systemText(input.messages),
        messages: anthropicMessages(input.messages),
        ...(input.tools?.length ? {
          tools: input.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters as unknown as Anthropic.Tool.InputSchema
          }))
        } : {})
      }, { signal: controller.signal });

      for await (const event of stream) {
        if (event.type === 'message_start') {
          requestId = event.message.id;
          responseModel = event.message.model || input.model;
          inputTokens = event.message.usage?.input_tokens;
          continue;
        }
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text' && event.content_block.text) {
            textParts.push(event.content_block.text);
            yield { type: 'text_delta', text: event.content_block.text };
          } else if (event.content_block.type === 'tool_use') {
            toolBuffers.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              argumentsText: '',
              initial: event.content_block.input !== null && typeof event.content_block.input === 'object' && !Array.isArray(event.content_block.input)
                ? event.content_block.input as Record<string, unknown>
                : {}
            });
            yield { type: 'tool_call_delta', index: event.index, id: event.content_block.id, name: event.content_block.name };
          }
          continue;
        }
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            if (event.delta.text) {
              textParts.push(event.delta.text);
              yield { type: 'text_delta', text: event.delta.text };
            }
          } else if (event.delta.type === 'input_json_delta') {
            const current = toolBuffers.get(event.index);
            if (current) {
              current.argumentsText += event.delta.partial_json;
              yield { type: 'tool_call_delta', index: event.index, id: current.id, name: current.name, argumentsDelta: event.delta.partial_json };
            }
          }
          continue;
        }
        if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens;
          continue;
        }
        if (event.type === 'message_stop') sawStop = true;
      }

      if (!sawStop) {
        throw new AppError('provider_stream_closed_early', 502, 'Anthropic closed the stream before message_stop.', {
          stage: 'streaming', retryable: true
        });
      }
      const toolCalls: LLMToolCall[] = [...toolBuffers.entries()].map(([index, value]) => {
        let parsed: Record<string, unknown> = value.initial;
        if (value.argumentsText.trim()) {
          try {
            const candidate = JSON.parse(value.argumentsText) as unknown;
            if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) parsed = candidate as Record<string, unknown>;
          } catch {
            throw new AppError('provider_invalid_tool_arguments', 502, `Anthropic returned malformed tool arguments for ${value.name}.`, {
              stage: 'streaming', retryable: false, toolIndex: index
            });
          }
        }
        return { id: value.id, name: value.name, arguments: parsed };
      });
      for (const call of toolCalls) yield { type: 'tool_call', call };
      const text = textParts.join('');
      if (!text.trim() && toolCalls.length === 0) {
        throw new AppError('provider_empty_response', 502, 'Anthropic returned an empty stream.', {
          stage: 'streaming', retryable: false
        });
      }
      const usage = inputTokens !== undefined || outputTokens !== undefined ? {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(inputTokens !== undefined && outputTokens !== undefined ? { totalTokens: inputTokens + outputTokens } : {})
      } : undefined;
      yield {
        type: 'completed',
        result: {
          text,
          toolCalls,
          model: responseModel,
          ...(requestId ? { requestId } : {}),
          ...(usage ? { usage } : {})
        }
      };
    } catch (error) {
      yield {
        type: 'error',
        diagnostic: diagnoseProviderError(error, {
          stage: 'streaming',
          testedEndpoint: input.config.resolvedChatUrl ?? undefined,
          testedModel: input.model
        })
      };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

}
