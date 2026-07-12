import { describe, expect, it, vi } from 'vitest';

const anthropicMocks = vi.hoisted(() => ({ stream: vi.fn() }));
const geminiMocks = vi.hoisted(() => ({ generateContentStream: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = { stream: anthropicMocks.stream };
  }
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class GoogleGenerativeAIMock {
    getGenerativeModel() {
      return { generateContentStream: geminiMocks.generateContentStream };
    }
  }
}));

import { AnthropicAdapter } from './anthropic.adapter.js';
import { GeminiAdapter } from './gemini.adapter.js';
import { getProviderDefinition } from '../registry.js';
import type { ProviderStreamEvent } from '../types.js';

async function collect(stream: AsyncIterable<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('native provider streaming adapters', () => {
  it('normalizes Anthropic text and streamed tool JSON', async () => {
    anthropicMocks.stream.mockReturnValue((async function* () {
      yield { type: 'message_start', message: { id: 'msg_1', model: 'claude-test', usage: { input_tokens: 4 } } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } };
      yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool_1', name: 'lookup', input: {} } };
      yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":"nar' } };
      yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'a"}' } };
      yield { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 6 } };
      yield { type: 'message_stop' };
    })());

    const adapter = new AnthropicAdapter(getProviderDefinition('anthropic'));
    const config = adapter.normalizeConfig({ apiKey: 'test-key', selectedModel: 'claude-test' });
    const events = await collect(adapter.streamChatCompletion!({
      config,
      model: 'claude-test',
      messages: [{ role: 'user', content: 'Hi' }]
    }));

    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.type === 'text_delta' ? event.text : '').join('')).toBe('Hello world');
    expect(events).toContainEqual({ type: 'tool_call', call: { id: 'tool_1', name: 'lookup', arguments: { q: 'nara' } } });
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      result: { text: 'Hello world', model: 'claude-test', requestId: 'msg_1', usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } }
    });
  });

  it('reports an incomplete Anthropic stream instead of returning false success', async () => {
    anthropicMocks.stream.mockReturnValue((async function* () {
      yield { type: 'message_start', message: { id: 'msg_2', model: 'claude-test', usage: { input_tokens: 1 } } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } };
    })());

    const adapter = new AnthropicAdapter(getProviderDefinition('anthropic'));
    const config = adapter.normalizeConfig({ apiKey: 'test-key', selectedModel: 'claude-test' });
    const events = await collect(adapter.streamChatCompletion!({ config, model: 'claude-test', messages: [{ role: 'user', content: 'Hi' }] }));
    expect(events.at(-1)).toMatchObject({ type: 'error', diagnostic: { ok: false, stage: 'streaming' } });
    expect(events.some((event) => event.type === 'completed')).toBe(false);
  });

  it('normalizes Gemini streaming chunks and final usage', async () => {
    const final = {
      text: () => 'AB',
      functionCalls: () => [{ name: 'search', args: { query: 'Nara' } }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 }
    };
    geminiMocks.generateContentStream.mockResolvedValue({
      stream: (async function* () {
        yield { text: () => 'A' };
        yield { text: () => 'B' };
      })(),
      response: Promise.resolve(final)
    });

    const adapter = new GeminiAdapter(getProviderDefinition('gemini'));
    const config = adapter.normalizeConfig({ apiKey: 'test-key', selectedModel: 'gemini-test' });
    const events = await collect(adapter.streamChatCompletion!({
      config,
      model: 'gemini-test',
      messages: [{ role: 'user', content: 'Hi' }]
    }));

    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.type === 'text_delta' ? event.text : '').join('')).toBe('AB');
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call', call: expect.objectContaining({ name: 'search', arguments: { query: 'Nara' } }) }));
    expect(events.at(-1)).toMatchObject({ type: 'completed', result: { text: 'AB', usage: { totalTokens: 5 } } });
  });
});
