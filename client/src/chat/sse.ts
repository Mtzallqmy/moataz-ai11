export type ClientSseEvent = { event: string; data: unknown };

export async function* readSse(response: Response): AsyncGenerator<ClientSseEvent> {
  if (!response.body) throw new Error('Empty SSE response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data: string[] = [];

  const flush = (): ClientSseEvent | undefined => {
    if (data.length === 0) { event = 'message'; return undefined; }
    const raw = data.join('\n');
    let parsed: unknown = raw;
    try { parsed = JSON.parse(raw) as unknown; } catch { /* keep text */ }
    const result = { event, data: parsed };
    event = 'message';
    data = [];
    return result;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        let line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          const item = flush();
          if (item) yield item;
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          let valueText = colon < 0 ? '' : line.slice(colon + 1);
          if (valueText.startsWith(' ')) valueText = valueText.slice(1);
          if (field === 'event') event = valueText || 'message';
          if (field === 'data') data.push(valueText);
        }
        index = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
    const final = flush();
    if (final) yield final;
  } finally {
    reader.releaseLock();
  }
}
