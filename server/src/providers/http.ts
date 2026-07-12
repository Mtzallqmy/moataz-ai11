import { AppError } from '../errors.js';
import { config } from '../config.js';
import { assertSafeOutboundUrl, readLimitedText } from '../network.js';
import { diagnoseProviderError, diagnosticToAppError } from './diagnostics.js';
import { providerRequestHeaders } from './headers.js';
import type { NormalizedProviderConfig, ProviderDiagnosticResult } from './types.js';

export type ProviderHttpResponse = {
  payload: unknown;
  status: number;
  headers: Headers;
  requestId?: string | undefined;
  latencyMs: number;
  url: string;
};

export type ProviderHttpStreamResponse = {
  response: Response;
  requestId?: string | undefined;
  latencyMs: number;
  url: string;
  dispose: () => void;
};

type ProviderHttpOptions = {
  method: 'GET' | 'POST';
  url: string;
  config: NormalizedProviderConfig;
  body?: unknown;
  signal?: AbortSignal | undefined;
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

function parsePayload(raw: string, contentType: string | null): unknown {
  if (!raw.trim()) return {};
  const looksJson = contentType?.toLowerCase().includes('json') || /^[\s\r\n]*[{[]/.test(raw);
  if (!looksJson) {
    throw new AppError('provider_invalid_response', 502, 'The provider returned a non-JSON response.', {
      providerMessage: raw.slice(0, 500), stage: 'inference', retryable: false
    });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError('provider_invalid_response', 502, 'The provider returned malformed JSON.', {
      providerMessage: raw.slice(0, 500), stage: 'inference', retryable: false
    });
  }
}

export function responseRequestId(headers: Headers): string | undefined {
  return headers.get('x-request-id')
    ?? headers.get('request-id')
    ?? headers.get('x-amzn-requestid')
    ?? headers.get('cf-ray')
    ?? undefined;
}

async function validatedProviderUrl(options: ProviderHttpOptions): Promise<URL> {
  const localAllowed = options.config.definition.allowLocalNetwork && config.allowLocalAiProviders;
  const validated = await assertSafeOutboundUrl(options.url, localAllowed);
  if (config.isProduction && validated.protocol !== 'https:') {
    throw new AppError('provider_https_required', 422, 'HTTPS is required for provider APIs in production.', {
      stage: 'configuration', retryable: false
    });
  }
  return validated;
}

function upstreamError(response: Response, payload: unknown): Error {
  return Object.assign(new Error(`Provider returned HTTP ${response.status}.`), {
    status: response.status,
    response: { status: response.status, data: payload, headers: response.headers }
  });
}

export async function providerHttpJson(options: ProviderHttpOptions): Promise<ProviderHttpResponse> {
  const validated = await validatedProviderUrl(options);
  const { signal, dispose } = combineSignals(options.signal, options.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(validated, {
      method: options.method,
      headers: providerRequestHeaders(options.config.definition, options.config.apiKey, options.config.customHeaders),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal,
      redirect: 'manual'
    });
    if (response.status >= 300 && response.status < 400) {
      throw new AppError('provider_redirect_unsupported', 422, 'Provider API redirects are not accepted. Use the final Base URL.', {
        stage: 'configuration', retryable: false
      });
    }
    const raw = await readLimitedText(response, options.maxResponseBytes);
    const payload = parsePayload(raw, response.headers.get('content-type'));
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const diagnostic = diagnoseProviderError(upstreamError(response, payload), {
        stage: options.method === 'GET' ? 'model_discovery' : 'inference',
        testedEndpoint: validated.toString(),
        latencyMs
      });
      throw diagnosticToAppError(diagnostic);
    }
    const requestId = responseRequestId(response.headers);
    return {
      payload,
      status: response.status,
      headers: response.headers,
      ...(requestId ? { requestId } : {}),
      latencyMs,
      url: validated.toString()
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const diagnostic: ProviderDiagnosticResult = diagnoseProviderError(error, {
      stage: options.method === 'GET' ? 'model_discovery' : 'inference',
      testedEndpoint: validated.toString(),
      latencyMs: Date.now() - started
    });
    throw diagnosticToAppError(diagnostic);
  } finally {
    dispose();
  }
}

export async function providerHttpStream(options: ProviderHttpOptions): Promise<ProviderHttpStreamResponse> {
  const validated = await validatedProviderUrl(options);
  const combined = combineSignals(options.signal, options.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(validated, {
      method: options.method,
      headers: providerRequestHeaders(options.config.definition, options.config.apiKey, options.config.customHeaders, 'text/event-stream'),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: combined.signal,
      redirect: 'manual'
    });
    if (response.status >= 300 && response.status < 400) {
      combined.dispose();
      throw new AppError('provider_redirect_unsupported', 422, 'Provider API redirects are not accepted. Use the final Base URL.', {
        stage: 'configuration', retryable: false
      });
    }
    if (!response.ok) {
      const raw = await readLimitedText(response, options.maxResponseBytes);
      let payload: unknown = raw;
      try { payload = raw ? JSON.parse(raw) as unknown : {}; } catch { /* preserve text */ }
      combined.dispose();
      throw diagnosticToAppError(diagnoseProviderError(upstreamError(response, payload), {
        stage: 'streaming', testedEndpoint: validated.toString(), latencyMs: Date.now() - started
      }));
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('text/event-stream')) {
      combined.dispose();
      throw diagnosticToAppError(diagnoseProviderError(new Error(`Expected text/event-stream but received ${contentType || 'unknown content type'}.`), {
        stage: 'streaming', testedEndpoint: validated.toString(), latencyMs: Date.now() - started
      }));
    }
    return {
      response,
      ...(responseRequestId(response.headers) ? { requestId: responseRequestId(response.headers) } : {}),
      latencyMs: Date.now() - started,
      url: validated.toString(),
      dispose: combined.dispose
    };
  } catch (error) {
    combined.dispose();
    if (error instanceof AppError) throw error;
    throw diagnosticToAppError(diagnoseProviderError(error, {
      stage: 'streaming', testedEndpoint: validated.toString(), latencyMs: Date.now() - started
    }));
  }
}
