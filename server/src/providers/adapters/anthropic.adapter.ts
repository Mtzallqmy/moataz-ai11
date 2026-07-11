import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../../errors.js';
import type { LLMToolCall, Msg } from '../../llm-types.js';
import { resolveProviderUrls } from '../base-url.js';
import type {
  ModelDiscoveryResult,
  ProviderAdapter,
  ProviderChatInput,
  ProviderChatResult,
  ProviderRuntimeConfig,
  ProviderStreamEvent
} from '../types.js';

function normalize(input: ProviderRuntimeConfig): ProviderRuntimeConfig {
  if (!input.apiKey.trim()) throw new AppError('provider_api_key_required', 422, 'An Anthropic API key is required.');
  const urls = resolveProviderUrls('anthropic', input.rawBaseUrl ?? input.normalizedBaseUrl);
  return { ...input, providerType: 'anthropic', rawBaseUrl: urls.rawBaseUrl, normalizedBaseUrl: urls.normalizedBaseUrl };
}

function clientFor(config: ProviderRuntimeConfig): Anthropic {
  return new Anthropic({
    apiKey: config.apiKey,
    ...(config.normalizedBaseUrl ? { baseURL: config.normalizedBaseUrl } : {})
  });
}

function systemPrompt(messages: readonly Msg[]): string {
  return messages.find((message) => message.role === 'system')?.content ?? 'You are Moataz AI.';
}

function anthropicMessages(messages: readonly Msg[]): Anthropic.MessageParam[] {
  return messages.flatMap((message): Anthropic.MessageParam[] => {
    if (message.role === 'system') return [];
    if (message.role === 'tool') {
      return [{
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }]
      } as Anthropic.MessageParam];
    }
    if (message.role === 'assistant') {
      const blocks: unknown[] = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      return [{ role: 'assistant', content: blocks.length > 0 ? blocks : message.content } as Anthropic.MessageParam];
    }
    const blocks: unknown[] = [];
    for (const image of message.images ?? []) {
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(image.mimeType)) continue;
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mimeType, data: image.dataBase64 }
      });
    }
    blocks.push({ type: 'text', text: message.content });
    return [{ role: 'user', content: blocks } as Anthropic.MessageParam];
  });
}

function parseOutput(output: Anthropic.Message, selectedModel: string): ProviderChatResult {
  const text: string[] = [];
  const calls: LLMToolCall[] = [];
  for (const block of output.content) {
    if (block.type === 'text') text.push(block.text);
    if (block.type === 'tool_use') {
      const input = block.input !== null && typeof block.input === 'object' && !Array.isArray(block.input)
        ? block.input as Record<string, unknown>
        : {};
      calls.push({ id: block.id, name: block.name, arguments: input });
    }
  }
  return {
    text: text.join('\n').trim(),
    toolCalls: calls,
    model: output.model || selectedModel,
    usage: {
      inputTokens: output.usage.input_tokens,
      outputTokens: output.usage.output_tokens,
      totalTokens: output.usage.input_tokens + output.usage.output_tokens
    }
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly protocol = 'anthropic' as const;

  normalizeConfig(input: ProviderRuntimeConfig): ProviderRuntimeConfig {
    return normalize(input);
  }

  async discoverModels(): Promise<ModelDiscoveryResult> {
    return {
      status: 'unsupported',
      models: [],
      testedEndpoints: [],
      latencyMs: 0,
      cached: false,
      message: 'Anthropic model discovery is not enabled; enter a model ID manually.'
    };
  }

  async createChatCompletion(input: ProviderChatInput): Promise<ProviderChatResult> {
    const config = normalize(input.config);
    const output = await clientFor(config).messages.create({
      model: config.model,
      system: systemPrompt(input.messages),
      messages: anthropicMessages(input.messages),
      max_tokens: input.maxOutputTokens ?? 3000,
      temperature: input.temperature ?? 0.3,
      ...(input.tools?.length ? {
        tools: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters as Anthropic.Tool.InputSchema
        }))
      } : {})
    }, { signal: input.signal });
    return parseOutput(output, config.model);
  }

  async *streamChatCompletion(input: ProviderChatInput): AsyncIterable<ProviderStreamEvent> {
    const config = normalize(input.config);
    const stream = clientFor(config).messages.stream({
      model: config.model,
      system: systemPrompt(input.messages),
      messages: anthropicMessages(input.messages),
      max_tokens: input.maxOutputTokens ?? 3000,
      temperature: input.temperature ?? 0.3,
      ...(input.tools?.length ? {
        tools: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters as Anthropic.Tool.InputSchema
        }))
      } : {})
    }, { signal: input.signal });
    stream.on('text', (text) => text);
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
        yield { type: 'text_delta', text: event.delta.text };
      }
      if (event.type === 'message_delta' && event.usage.output_tokens !== undefined) {
        yield { type: 'usage', outputTokens: event.usage.output_tokens };
      }
    }
    const final = await stream.finalMessage();
    for (const block of final.content) {
      if (block.type !== 'tool_use') continue;
      const args = block.input !== null && typeof block.input === 'object' && !Array.isArray(block.input)
        ? block.input as Record<string, unknown>
        : {};
      yield { type: 'tool_call', call: { id: block.id, name: block.name, arguments: args } };
    }
    yield { type: 'done', model: final.model || config.model };
  }
}
