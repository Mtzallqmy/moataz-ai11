import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import {
  failedProviderDiagnostic,
  providerErrorWithDiagnostic,
  successfulProviderDiagnostic
} from './provider-diagnostics.js';

describe('provider diagnostics', () => {
  it('does not guess that a successful key is free or paid', () => {
    const diagnostic = successfulProviderDiagnostic({
      providerType: 'openrouter',
      selectedModel: 'openai/gpt-4.1-mini',
      modelsSupported: true,
      modelCount: 12
    });

    expect(diagnostic.availability).toBe('available');
    expect(diagnostic.plan).toBe('unknown');
    expect(diagnostic.billing).toBe('request_succeeded');
    expect(diagnostic.planDetection).toBe('not_exposed');
    expect(diagnostic.modelCount).toBe(12);
  });

  it('classifies explicit credit failures as paid access requirements', () => {
    const error = new AppError('provider_billing', 402, 'Insufficient credits.', {
      stage: 'billing',
      retryable: false
    });
    const diagnostic = failedProviderDiagnostic('openrouter', error);

    expect(diagnostic.availability).toBe('unavailable');
    expect(diagnostic.plan).toBe('paid');
    expect(diagnostic.billing).toBe('credits_required');
    expect(diagnostic.planDetection).toBe('inferred_from_error');
  });

  it('attaches diagnostics without losing upstream details', () => {
    const source = new AppError('provider_authentication', 401, 'Invalid API key.', {
      stage: 'authentication',
      providerMessage: 'Invalid API key.',
      retryable: false
    });
    const wrapped = providerErrorWithDiagnostic('nvidia', source);
    const details = wrapped.details as Record<string, unknown>;

    expect(wrapped.code).toBe('provider_authentication');
    expect(details.providerMessage).toBe('Invalid API key.');
    expect((details.diagnostic as { errorStage: string }).errorStage).toBe('authentication');
  });
});
