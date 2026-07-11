import { AppError } from '../errors.js';
import { assertSafeOutboundUrl, readLimitedText } from '../network.js';

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly payload: unknown;
  readonly headers: Record<string, string>;

  constructor(input: { status: number; url: string; payload: unknown; headers: Headers; message: string }) {
    super(input.message);
    this.name = 'ProviderHttpError';
    this.status = input.status;
    this.url = input.url;
    this.payload = input.payload;
    this.headers = Object.fromEntries(input.headers.entries());
  }
}

export type ProviderHttpOptions = {
  timeoutMs: number;
  maxResponseBytes: number;
  allowPrivateNetwork: boolean;
};

export type ProviderHttpResponse<T> = {
  status: number;
  url: string;
  data: T;
  headers: Headers;
  latencyMs: number;
};

function messageFromPayload(payload: unknown, fallback: string): string {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const root = payload as Record<string, unknown>;
    const nested = root.error !== null && typeof root.error === 'object' && !Array.isArray(root.error)
      ? root.error as Record<string, unknown>
      : {};
    const values = [nested.message, nested.detail, root.message, root.detail, root.error_description, root.error];
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 1200);
    }
  }
  return fallback;
}

async function parseResponse(response: Response, maxBytes: number): Promise<unknown> {
  const raw = await readLimitedText(response, maxBytes);
  if (!raw.trim()) return {};
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('json')) {
    if (/^\s*</.test(raw)) {
      throw new AppError('provider_invalid_response', 502, 'The provider returned HTML instead of JSON.', {
        status: 'invalid_response', upstreamStatus: response.status, retryable: false
      });
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new AppError('provider_invalid_response', 502, 'The provider returned a non-JSON response.', {
        status: 'invalid_response', upstreamStatus: response.status, retryable: false
      });
    }
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError('provider_invalid_response', 502, 'The provider returned malformed JSON.', {
      status: 'invalid_response', upstreamStatus: response.status, retryable: false
    });
  }
}

export async function providerJsonRequest<T>(
  rawUrl: string,
  init: Omit<RequestInit, 'redirect' | 'signal'>,
  options: ProviderHttpOptions,
  externalSignal?: AbortSignal
): Promise<ProviderHttpResponse<T>> {
  const url = await assertSafeOutboundUrl(rawUrl, options.allowPrivateNetwork);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), options.timeoutMs);
  timer.unref();
  const onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) onAbort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      throw new ProviderHttpError({
        status: response.status,
        url: url.toString(),
        payload: { message: 'Provider redirects are not accepted for API requests.' },
        headers: response.headers,
        message: 'Provider redirects are not accepted for API requests.'
      });
    }
    const payload = await parseResponse(response, options.maxResponseBytes);
    if (!response.ok) {
      throw new ProviderHttpError({
        status: response.status,
        url: url.toString(),
        payload,
        headers: response.headers,
        message: messageFromPayload(payload, `Provider returned HTTP ${response.status}.`)
      });
    }
    return {
      status: response.status,
      url: url.toString(),
      data: payload as T,
      headers: response.headers,
      latencyMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}
