import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import { providerErrorWithDiagnostic } from './provider-diagnostics.js';
import { diagnoseProviderError } from './providers/diagnostics.js';

function upstream(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data: body, headers }
  });
}

describe('provider diagnostics', () => {
  it.each([
    [400, { error: { code: 'invalid_request_error', message: 'temperature is unsupported' } }, 'invalid_request'],
    [401, { error: { code: 'invalid_api_key', message: 'Invalid API key' } }, 'invalid_api_key'],
    [402, { error: { code: 'payment_required', message: 'Payment required' } }, 'billing_required'],
    [403, { error: { code: 'model_access_denied', message: 'Model is not allowed' } }, 'model_not_allowed'],
    [429, { error: { code: 'rate_limit', message: 'Rate limit reached' } }, 'rate_limited'],
    [429, { error: { code: 'insufficient_quota', message: 'Quota exceeded' } }, 'insufficient_quota'],
    [503, { error: { message: 'Upstream unavailable' } }, 'provider_unavailable']
  ] as const)('maps HTTP %s to %s without generic payment guesses', (status, body, expected) => {
    const diagnostic = diagnoseProviderError(upstream(status, body), {
      stage: 'inference', testedModel: 'provider/model', discoverySucceeded: true
    });
    expect(diagnostic.status).toBe(expected);
    if (status !== 402) expect(diagnostic.status).not.toBe('billing_required');
  });

  it('distinguishes a missing models endpoint from a missing model', () => {
    const endpoint = diagnoseProviderError(upstream(404, { error: { message: 'Not found' } }), {
      stage: 'model_discovery', testedEndpoint: 'https://example.com/v1/models'
    });
    const model = diagnoseProviderError(upstream(404, { error: { message: 'Model deployment not found' } }), {
      stage: 'inference', testedEndpoint: 'https://example.com/v1/chat/completions', testedModel: 'missing/model'
    });
    expect(endpoint.status).toBe('endpoint_not_found');
    expect(model.status).toBe('model_not_found');
  });

  it('preserves retry-after and upstream request IDs', () => {
    const diagnostic = diagnoseProviderError(upstream(429, { error: { code: 'rate_limit', message: 'Too many requests' } }, {
      'retry-after': '7',
      'x-request-id': 'upstream-123'
    }));
    expect(diagnostic.retryAfterSeconds).toBe(7);
    expect(diagnostic.upstreamRequestId).toBe('upstream-123');
    expect(diagnostic.retryable).toBe(true);
  });

  it('does not classify a generic 403 as an invalid key or payment error', () => {
    const diagnostic = diagnoseProviderError(upstream(403, { error: { message: 'Access forbidden' } }), {
      discoverySucceeded: true
    });
    expect(diagnostic.status).toBe('forbidden');
    expect(diagnostic.keyValid).toBe(true);
  });

  it('classifies timeout, DNS, TLS, malformed responses, and network resets separately', () => {
    expect(diagnoseProviderError(new Error('request timed out')).status).toBe('timeout');
    expect(diagnoseProviderError(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })).status).toBe('dns_error');
    expect(diagnoseProviderError(new Error('unable to verify TLS certificate')).status).toBe('tls_error');
    expect(diagnoseProviderError(new Error('malformed JSON response')).status).toBe('invalid_response');
    expect(diagnoseProviderError(Object.assign(new Error('socket connection reset'), { code: 'ECONNRESET' })).status).toBe('network_error');
  });

  it('attaches normalized diagnostics without losing safe upstream details', () => {
    const source = new AppError('provider_authorization', 403, 'Model forbidden.', {
      providerMessage: 'Model forbidden.',
      diagnostic: diagnoseProviderError(upstream(403, { error: { code: 'model_access_denied', message: 'Model forbidden.' } }), {
        testedModel: 'model-x', discoverySucceeded: true
      })
    });
    const wrapped = providerErrorWithDiagnostic('nararouter', source);
    const details = wrapped.details as Record<string, unknown>;
    expect(wrapped.code).toBe('provider_authorization');
    expect(details.providerMessage).toBe('Model forbidden.');
    expect((details.diagnostic as { status: string }).status).toBe('model_not_allowed');
  });
});
