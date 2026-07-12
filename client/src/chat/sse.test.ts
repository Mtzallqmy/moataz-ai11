import { describe, expect, it } from 'vitest';
import { readSse } from './sse';

function response(parts: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    }
  }), { headers: { 'content-type': 'text/event-stream' } });
}

describe('client SSE reader', () => {
  it('parses status, split deltas, completed events, and comments', async () => {
    const events = [];
    for await (const event of readSse(response([
      ': keepalive\n\nevent: status\ndata: {"stage":"connecting"}\n\n',
      'event: delta\ndata: {"text":"مر',
      'حبًا"}\n\nevent: completed\ndata: {"message":{"id":"a","role":"assistant","content":"مرحبًا"}}\n\n'
    ]))) events.push(event);
    expect(events).toEqual([
      { event: 'status', data: { stage: 'connecting' } },
      { event: 'delta', data: { text: 'مرحبًا' } },
      { event: 'completed', data: { message: { id: 'a', role: 'assistant', content: 'مرحبًا' } } }
    ]);
  });
});
