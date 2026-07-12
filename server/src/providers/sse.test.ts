import { describe, expect, it } from 'vitest';
import { parseSseStream } from './sse.js';

function streamFrom(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    }
  });
}

describe('provider SSE parser', () => {
  it('handles JSON split across chunks, multiple events, heartbeats, and DONE', async () => {
    const messages = [];
    const stream = streamFrom([
      ': heartbeat\n\ndata: {"choices":[{"delta":{"content":"Hel',
      'lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" 🌍"}}]}\n\n',
      'data: [DONE]\n\n'
    ]);
    for await (const message of parseSseStream(stream)) messages.push(message.data);
    expect(messages).toEqual([
      '{"choices":[{"delta":{"content":"Hello"}}]}',
      '{"choices":[{"delta":{"content":" 🌍"}}]}',
      '[DONE]'
    ]);
  });

  it('joins multiple data lines in one event and preserves unicode boundaries', async () => {
    const source = 'event: error\ndata: {"error":\ndata: "فشل"}\n\n';
    const bytes = new TextEncoder().encode(source);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, bytes.length - 2));
        controller.enqueue(bytes.slice(bytes.length - 2));
        controller.close();
      }
    });
    const messages = [];
    for await (const message of parseSseStream(stream)) messages.push(message);
    expect(messages).toEqual([{ event: 'error', data: '{"error":\n"فشل"}' }]);
  });
});
