import { AppError } from './errors.js';
import { diagnoseProviderError } from './providers/diagnostics.js';
import type { ProviderDiagnosticResult } from './providers/types.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function existingDiagnostic(error: unknown): ProviderDiagnosticResult | undefined {
  if (!(error instanceof AppError)) return undefined;
  const diagnostic = record(error.details).diagnostic;
  return diagnostic !== null && typeof diagnostic === 'object' && !Array.isArray(diagnostic)
    ? diagnostic as ProviderDiagnosticResult
    : undefined;
}

export function providerErrorWithDiagnostic(_providerType: string, error: unknown): AppError {
  const diagnostic = existingDiagnostic(error) ?? diagnoseProviderError(error);
  if (error instanceof AppError) {
    return new AppError(error.code, error.status, error.message, {
      ...record(error.details),
      diagnostic
    });
  }
  return new AppError(`provider_${diagnostic.status}`, diagnostic.httpStatus ?? 502, diagnostic.userMessageEn, {
    domain: 'provider',
    stage: diagnostic.stage,
    retryable: diagnostic.retryable,
    diagnostic
  });
}

export function failedProviderDiagnostic(_providerType: string, error: unknown): {
  errorStage: string;
  retryable: boolean;
  note: string;
} {
  const diagnostic = existingDiagnostic(error) ?? diagnoseProviderError(error);
  return {
    errorStage: diagnostic.status,
    retryable: diagnostic.retryable,
    note: diagnostic.userMessage
  };
}
