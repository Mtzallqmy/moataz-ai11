import { AppError } from '../errors.js';
import { assertSafeOutboundUrl, readLimitedText } from '../network.js';
import { diagnoseProviderError, diagnosticToAppError } from './diagnostics.js';
import type { NormalizedProviderConfig, ProviderDiagnosticResult } from './types.js';

export type ProviderHttpResponse = {
  payload: unknown;
  status: number;
  headers: Headers;
  requestId?: string;
  latencyMs: number;
  url: string;
};

type ProviderHttpOptions = {
  method: 'GET' | 'POST';
  url: string;
  config: NormalizedProviderConfig;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs: number;
  maxResponseBytes: number;
};

function combineSignals(external: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), timeoutMs);
  timer.unref();
  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  };
}

function requestHeaders(config: NormalizedProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...config.definition.defaultHeaders,
    ...config.customHeaders
  };
  if (config.definition.authentication === 'bearer' && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (config.definition.authentication === 'x-api-key' && config.apiKey) headers['x-api-key'] = config.apiKey;
  if (config.definition.id === 'openrouter') {
    headers['HTTP-Referer'] = process.env.APP_URL || 'https://moataz.ai';
    headers['X-Title'] = 'Moataz AI';
  }
  return headers;
}

function parsePayload(raw: string, contentType: string | null): unknown {
  if (!raw.trim()) return {};
  const looksJson = contentType?.toLowerCase().includes('json') || /^[\s\r\n]*[{[]/.test(raw);
  if (!looksJson) {
    throw new AppError('provider_invalid_response', 502, 'The provider returned a non-JSON response.', {
      providerMessage: raw.slice(0, 500), stage: 'invalid_response', retryable: true
    });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError('provider_invalid_response', 502, 'The provider returned malformed JSON.', {
      providerMessage: raw.slice(0, 500), stage: 'invalid_response', retryable: true
    });
  }
}

function responseRequestId(headers: Headers): string | undefined {
  return headers.get('x-request-id')
    ?? headers.get('request-id')
    ?? headers.get('x-amzn-requestid')
    ?? headers.get('cf-ray')
    ?? undefined;
}

export async function providerHttpJson(options: ProviderHttpOptions): Promise<ProviderHttpResponse> {
  const allowPrivate = options.config.definition.allowLocalNetwork && process.env.NODE_ENV !== 'production';
  const validated = await assertSafeOutboundUrl(options.url, allowPrivate);
  const { signal, dispose } = combineSignals(options.signal, options.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(validated, {
      method: options.method,
      headers: requestHeaders(options.config),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal,
      redirect: 'manual'
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new AppError('provider_endpoint_not_found', 422, 'The provider returned an empty redirect.');
      const target = new URL(location, validated);
      if (target.origin !== validated.origin) {
        throw new AppError('provider_redirect_forbidden', 422, 'Provider API redirects to another origin are not allowed.', {
          stage: 'invalid_request', retryable: false
        });
      }
      throw new AppError('provider_redirect_unsupported', 422, 'Provider API redirects are not accepted. Use the final Base URL.', {
        stage: 'invalid_request', retryable: false
      });
    }
    const raw = await readLimitedText(response, options.maxResponseBytes);
    const payload = parsePayload(raw, response.headers.get('content-type'));
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const error = Object.assign(new Error(`Provider returned HTTP ${response.status}.`), {
        status: response.status,
        response: { status: response.status, data: payload, headers: response.headers }
      });
      const diagnostic = diagnoseProviderError(error, {
        testedEndpoint: validated.toString(),
        latencyMs,
        requestId: undefined
      });
      throw diagnosticToAppError(diagnostic);
    }
    return {
      payload,
      status: response.status,
      headers: response.headers,
      ...(responseRequestId(response.headers) ? { requestId: responseRequestId(response.headers) } : {}),
      latencyMs,
      url: validated.toString()
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const diagnostic: ProviderDiagnosticResult = diagnoseProviderError(error, {
      testedEndpoint: validated.toString(),
      latencyMs: Date.now() - started
    });
    throw diagnosticToAppError(diagnostic);
  } finally {
    dispose();
  }
}
