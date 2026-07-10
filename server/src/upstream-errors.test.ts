import { describe, expect, it } from 'vitest';
import { classifyUpstreamError, upstreamAppError } from './upstream-errors.js';

describe('upstream error classification', () => {
  it('preserves billing failures instead of converting them to internal_error', () => {
    const result = classifyUpstreamError({ status: 402, message: 'This request requires more credits.' });
    expect(result).toMatchObject({ stage: 'billing', status: 402, retryable: false, upstreamStatus: 402 });
  });

  it('maps authentication and rate-limit failures to useful statuses', () => {
    expect(classifyUpstreamError({ status: 401, message: 'Invalid API key' }).stage).toBe('authentication');
    expect(classifyUpstreamError({ status: 429, message: 'Too many requests' })).toMatchObject({ stage: 'rate_limit', status: 429, retryable: true });
  });

  it('returns structured safe details', () => {
    const error = upstreamAppError('provider', 'openrouter', { status: 404, message: 'Model not found' });
    expect(error.code).toBe('provider_model_not_found');
    expect(error.status).toBe(422);
    expect(error.details).toMatchObject({ domain: 'provider', service: 'openrouter', stage: 'model_not_found' });
  });

  it('reads Telegram API error codes and descriptions', () => {
    const mapped = classifyUpstreamError({ response: { body: { ok: false, error_code: 401, description: 'Unauthorized' } } });
    expect(mapped.stage).toBe('authentication');
    expect(mapped.upstreamStatus).toBe(401);
    expect(mapped.message).toBe('Unauthorized');
  });
});
