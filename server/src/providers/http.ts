import { config } from '../config.js';
import { AppError } from '../errors.js';
import { fetchWithValidatedRedirects, readLimitedText } from '../network.js';

export class ProviderHttpError extends Error {
  readonly status?: number;
  readonly payload?: unknown;
  readonly endpoint?: string;
  readonly upstreamRequestId?: string;
  readonly causeCode?: string;

  constructor(message: string, options: {
    status?: number;
    payload?: unknown;
    endpoint?: string;
    upstreamRequestId?: string;
    causeCode?: string;
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

type ProviderHttpResult = {
  status: number;
  headers: Headers;
  payload: unknown;
  endpoint: string;
  latencyMs: number;
  upstreamRequestId?: string;
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

export async function providerHttpJson(input: {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  allowPrivate?: boolean;
}): Promise<ProviderHttpResult> {
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
            endpoint: response.url || input.url,
            upstreamRequestId: requestId(response.headers),
            causeCode: contentType.includes('text/html') ? 'html_response' : 'malformed_json'
          });
        }
        payload = raw.slice(0, 1200);
      }
    }
    const endpoint = response.url || input.url;
    const upstreamRequestId = requestId(response.headers);
    if (!response.ok) {
      throw new ProviderHttpError(errorMessage(payload, `Provider returned HTTP ${response.status}.`), {
        status: response.status,
        payload,
        endpoint,
        upstreamRequestId
      });
    }
    return {
      status: response.status,
      headers: response.headers,
      payload,
      endpoint,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      ...(upstreamRequestId ? { upstreamRequestId } : {})
    };
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    if (error instanceof AppError) throw error;
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    throw new ProviderHttpError(error instanceof Error ? error.message : String(error), {
      endpoint: input.url,
      ...(code ? { causeCode: code } : {})
    });
  } finally {
    controlled.dispose();
  }
}
