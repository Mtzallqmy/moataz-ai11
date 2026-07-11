import { config } from '../config.js';
import { AppError } from '../errors.js';
import { fetchWithValidatedRedirects, readLimitedText } from '../network.js';

export class ProviderHttpError extends Error {
  readonly status: number | undefined;
  readonly payload: unknown;
  readonly endpoint: string | undefined;
  readonly upstreamRequestId: string | undefined;
  readonly causeCode: string | undefined;

  constructor(message: string, options: {
    status?: number | undefined;
    payload?: unknown;
    endpoint?: string | undefined;
    upstreamRequestId?: string | undefined;
    causeCode?: string | undefined;
  } = {}) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = options.status;
    this.payload = options.payload;
    this.endpoint = options.endpoint;
    this.upstreamRequestId = options.upstreamRequestId;
    this.causeCode = options.causeCode;
  }
}

export type ProviderHttpResult = {
  status: number;
  headers: Headers;
  payload: unknown;
  endpoint: string;
  latencyMs: number;
  upstreamRequestId?: string | undefined;
};

export type ProviderStreamResponse = {
  response: Response;
  endpoint: string;
  latencyMs: number;
  upstreamRequestId?: string | undefined;
  dispose: () => void;
};

type ProviderRequestInput = {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
  allowPrivate?: boolean | undefined;
};

function requestId(headers: Headers): string | undefined {
  for (const name of ['x-request-id', 'request-id', 'x-amzn-requestid', 'cf-ray', 'x-goog-request-id']) {
    const value = headers.get(name)?.trim();
    if (value) return value.slice(0, 200);
  }
  return undefined;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 1200);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return fallback;
  const root = payload as Record<string, unknown>;
  const nested = root.error !== null && typeof root.error === 'object' && !Array.isArray(root.error)
    ? root.error as Record<string, unknown>
    : undefined;
  for (const candidate of [nested?.message, nested?.detail, root.message, root.detail, root.error_description, root.description]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 1200);
  }
  if (typeof root.error === 'string' && root.error.trim()) return root.error.trim().slice(0, 1200);
  return fallback;
}

function abortSignal(external: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), timeoutMs);
  timer.unref();
  const forward = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) forward();
    else external.addEventListener('abort', forward, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', forward);
    }
  };
}

async function providerResponse(input: ProviderRequestInput): Promise<ProviderStreamResponse> {
  const timeoutMs = input.timeoutMs ?? config.providerRequestTimeoutMs;
  const started = performance.now();
  const controlled = abortSignal(input.signal, timeoutMs);
  try {
    const response = await fetchWithValidatedRedirects(input.url, {
      method: input.method,
      headers: input.headers,
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      signal: controlled.signal
    }, {
      timeoutMs,
      maxRedirects: config.providerMaxRedirects,
      allowPrivate: input.allowPrivate === true
    });
    const endpoint = response.url || input.url;
    const upstreamRequestId = requestId(response.headers);
    return {
      response,
      endpoint,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      ...(upstreamRequestId ? { upstreamRequestId } : {}),
      dispose: controlled.dispose
    };
  } catch (error) {
    controlled.dispose();
    if (error instanceof ProviderHttpError) throw error;
    if (error instanceof AppError) throw error;
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    throw new ProviderHttpError(error instanceof Error ? error.message : String(error), {
      endpoint: input.url,
      ...(code ? { causeCode: code } : {})
    });
  }
}

export async function providerHttpJson(input: ProviderRequestInput): Promise<ProviderHttpResult> {
  const transport = await providerResponse(input);
  try {
    const { response, endpoint, upstreamRequestId, latencyMs } = transport;
    const raw = await readLimitedText(response, input.maxBytes ?? config.providerMaxResponseBytes);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    let payload: unknown = null;
    if (raw.trim()) {
      try {
        payload = JSON.parse(raw) as unknown;
      } catch {
        if (response.ok) {
          throw new ProviderHttpError('The provider returned malformed JSON.', {
            status: response.status,
            payload: raw.slice(0, 500),
            endpoint,
            ...(upstreamRequestId ? { upstreamRequestId } : {}),
            causeCode: contentType.includes('text/html') ? 'html_response' : 'malformed_json'
          });
        }
        payload = raw.slice(0, 1200);
      }
    }
    if (!response.ok) {
      throw new ProviderHttpError(errorMessage(payload, `Provider returned HTTP ${response.status}.`), {
        status: response.status,
        payload,
        endpoint,
        ...(upstreamRequestId ? { upstreamRequestId } : {})
      });
    }
    return {
      status: response.status,
      headers: response.headers,
      payload,
      endpoint,
      latencyMs,
      ...(upstreamRequestId ? { upstreamRequestId } : {})
    };
  } finally {
    transport.dispose();
  }
}

export async function providerHttpStream(input: ProviderRequestInput): Promise<ProviderStreamResponse> {
  const transport = await providerResponse(input);
  if (!transport.response.ok || !transport.response.body) {
    try {
      const raw = await readLimitedText(transport.response, Math.min(config.providerMaxResponseBytes, 64_000));
      let payload: unknown = raw;
      try { payload = raw ? JSON.parse(raw) as unknown : null; } catch { /* keep redacted text */ }
      throw new ProviderHttpError(errorMessage(payload, `Provider returned HTTP ${transport.response.status}.`), {
        status: transport.response.status,
        payload,
        endpoint: transport.endpoint,
        ...(transport.upstreamRequestId ? { upstreamRequestId: transport.upstreamRequestId } : {})
      });
    } finally {
      transport.dispose();
    }
  }
  return transport;
}
