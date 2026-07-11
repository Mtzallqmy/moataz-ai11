import { AppError } from './errors.js';
import { classifyUpstreamError, type UpstreamStage } from './upstream-errors.js';

export type ProviderAvailability = 'available' | 'limited' | 'unavailable' | 'unknown';
export type ProviderPlan = 'free' | 'paid' | 'mixed' | 'unknown';
export type ProviderBillingState = 'request_succeeded' | 'credits_required' | 'rate_limited' | 'not_checked' | 'unknown';
export type ProviderPlanDetection = 'provider_declared' | 'inferred_from_error' | 'not_exposed';

export type ProviderDiagnostic = {
  providerType: string;
  availability: ProviderAvailability;
  plan: ProviderPlan;
  billing: ProviderBillingState;
  planDetection: ProviderPlanDetection;
  completionSucceeded: boolean;
  modelsEndpoint: 'supported' | 'unsupported' | 'failed' | 'not_checked';
  modelCount: number;
  selectedModel?: string;
  errorStage?: UpstreamStage;
  retryable: boolean;
  evidence: string[];
  note: string;
  checkedAt: string;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function stageFrom(error: unknown): { stage: UpstreamStage; retryable: boolean } {
  if (error instanceof AppError) {
    const details = record(error.details);
    const stage = details.stage;
    if (typeof stage === 'string' && [
      'authentication', 'authorization', 'billing', 'rate_limit', 'model_not_found',
      'invalid_request', 'timeout', 'network', 'service_unavailable', 'unknown'
    ].includes(stage)) {
      return { stage: stage as UpstreamStage, retryable: details.retryable === true };
    }
  }
  const classified = classifyUpstreamError(error);
  return { stage: classified.stage, retryable: classified.retryable };
}

export function successfulProviderDiagnostic(input: {
  providerType: string;
  selectedModel: string;
  modelsSupported: boolean;
  modelsFailed?: boolean;
  modelCount: number;
}): ProviderDiagnostic {
  const modelsEndpoint = input.modelsFailed
    ? 'failed'
    : input.modelsSupported
      ? 'supported'
      : 'unsupported';
  const evidence = [
    'api_key_accepted',
    'model_completion_succeeded',
    input.modelsSupported ? 'models_endpoint_succeeded' : input.modelsFailed ? 'models_endpoint_failed' : 'models_endpoint_not_supported'
  ];
  return {
    providerType: input.providerType,
    availability: 'available',
    plan: 'unknown',
    billing: 'request_succeeded',
    planDetection: 'not_exposed',
    completionSucceeded: true,
    modelsEndpoint,
    modelCount: input.modelCount,
    selectedModel: input.selectedModel,
    retryable: false,
    evidence,
    note: 'The key can make a model request now. Most providers do not expose whether a key belongs to a free or paid plan, so the plan is not guessed.',
    checkedAt: new Date().toISOString()
  };
}

export function failedProviderDiagnostic(providerType: string, error: unknown): ProviderDiagnostic {
  const { stage, retryable } = stageFrom(error);
  const availability: ProviderAvailability = stage === 'rate_limit'
    ? 'limited'
    : stage === 'timeout' || stage === 'network' || stage === 'service_unavailable'
      ? 'unknown'
      : 'unavailable';
  const billing: ProviderBillingState = stage === 'billing'
    ? 'credits_required'
    : stage === 'rate_limit'
      ? 'rate_limited'
      : 'unknown';
  const plan: ProviderPlan = stage === 'billing' ? 'paid' : 'unknown';
  const noteByStage: Record<UpstreamStage, string> = {
    authentication: 'The provider rejected the API key or token.',
    authorization: 'The key was recognized but does not have permission for this resource or model.',
    billing: 'The provider explicitly reported a billing, credit, or quota requirement. Payment or additional credits are required before this request can run.',
    rate_limit: 'The key reached a request or token limit. This does not prove whether the plan is free or paid.',
    model_not_found: 'The key reached the provider, but the selected model is missing or unavailable to this account.',
    invalid_request: 'The provider received the request but rejected its model name, endpoint, or request format.',
    timeout: 'The provider did not finish the request before the configured timeout.',
    network: 'The provider endpoint could not be reached or its TLS/DNS connection failed.',
    service_unavailable: 'The provider is temporarily unavailable.',
    unknown: 'The provider returned an error that could not be classified safely.'
  };
  return {
    providerType,
    availability,
    plan,
    billing,
    planDetection: stage === 'billing' ? 'inferred_from_error' : 'not_exposed',
    completionSucceeded: false,
    modelsEndpoint: 'not_checked',
    modelCount: 0,
    errorStage: stage,
    retryable,
    evidence: [`provider_error_${stage}`],
    note: noteByStage[stage],
    checkedAt: new Date().toISOString()
  };
}

export function providerErrorWithDiagnostic(providerType: string, error: unknown): AppError {
  const diagnostic = failedProviderDiagnostic(providerType, error);
  if (error instanceof AppError) {
    return new AppError(error.code, error.status, error.message, {
      ...record(error.details),
      diagnostic
    });
  }
  const classified = classifyUpstreamError(error);
  return new AppError(`provider_${classified.stage}`, classified.status, classified.message, {
    domain: 'provider',
    service: providerType,
    stage: classified.stage,
    ...(classified.upstreamStatus !== undefined ? { upstreamStatus: classified.upstreamStatus } : {}),
    providerMessage: classified.message,
    retryable: classified.retryable,
    diagnostic
  });
}
