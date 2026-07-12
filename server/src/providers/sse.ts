import { AppError } from '../errors.js';

export type SseMessage = {
  event?: string | undefined;
  data: string;
  id?: string | undefined;
};

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  options: { maxBytes?: number | undefined } = {}
): AsyncGenerator<SseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  let total = 0;
  let buffer = '';
  let dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  const flush = (): SseMessage | undefined => {
    if (dataLines.length === 0) {
      event = undefined;
      id = undefined;
      return undefined;
    }
    const message: SseMessage = {
      data: dataLines.join('\n'),
      ...(event ? { event } : {}),
      ...(id ? { id } : {})
    };
    dataLines = [];
    event = undefined;
    id = undefined;
    return message;
  };

  const processLine = (line: string): SseMessage | undefined => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (normalized === '') return flush();
    if (normalized.startsWith(':')) return undefined;
    const colon = normalized.indexOf(':');
    const field = colon === -1 ? normalized : normalized.slice(0, colon);
    let value = colon === -1 ? '' : normalized.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
    return undefined;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new AppError('provider_stream_too_large', 413, 'The provider stream exceeded the configured size limit.');
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const message = processLine(line);
        if (message) yield message;
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const message = processLine(buffer);
      if (message) yield message;
    }
    const final = flush();
    if (final) yield final;
  } finally {
    reader.releaseLock();
  }
}
