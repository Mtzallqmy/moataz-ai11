import { AppError } from './errors.js';
import { redactText } from './redaction.js';

export type UpstreamDomain = 'provider' | 'integration';
export type UpstreamStage =
  | 'authentication'
  | 'authorization'
  | 'billing'
  | 'rate_limit'
  | 'model_not_found'
  | 'invalid_request'
  | 'timeout'
  | 'network'
  | 'service_unavailable'
  | 'unknown';

export type UpstreamErrorDetails = {
  domain: UpstreamDomain;
  service: string;
  stage: UpstreamStage;
  upstreamStatus?: number;
  providerMessage: string;
  retryable: boolean;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function numericStatus(error: unknown): number | undefined {
  const root = record(error);
  const response = record(root?.response);
  const responseBody = record(response?.body) ?? record(response?.data);
  const candidates = [root?.status, root?.statusCode, response?.status, responseBody?.error_code, responseBody?.status];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  }
  return undefined;
}

function upstreamMessage(error: unknown): string {
  const root = record(error);
  const response = record(root?.response);
  const body = record(root?.error) ?? record(response?.data) ?? record(response?.body);
  const candidates = [
    root?.message,
    body?.message,
    body?.description,
    body?.error,
    response?.statusText,
    typeof error === 'string' ? error : undefined
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return redactText(candidate.trim()).slice(0, 1200);
    }
  }
  return 'Upstream service request failed.';
}

export function classifyUpstreamError(error: unknown): {
  stage: UpstreamStage;
  status: number;
  upstreamStatus?: number;
  retryable: boolean;
  message: string;
} {
  const upstreamStatus = numericStatus(error);
  const message = upstreamMessage(error);
  const normalized = message.toLowerCase();

  if (/abort|timeout|timed out|deadline exceeded/.test(normalized)) {
    return { stage: 'timeout', status: 504, upstreamStatus, retryable: true, message };
  }
  if (upstreamStatus === 401 || /unauthorized|invalid (api )?key|incorrect (api )?key|invalid token|token is invalid/.test(normalized)) {
    return { stage: 'authentication', status: 401, upstreamStatus, retryable: false, message };
  }
  if (upstreamStatus === 402 || /payment required|insufficient credits?|not enough credits?|billing|quota exceeded/.test(normalized)) {
    return { stage: 'billing', status: 402, upstreamStatus, retryable: false, message };
  }
  if (upstreamStatus === 403 || /forbidden|permission denied|insufficient scope|not allowed/.test(normalized)) {
    return { stage: 'authorization', status: 403, upstreamStatus, retryable: false, message };
  }
  if (upstreamStatus === 404 || /model.*not found|unknown model|no such model|does not exist/.test(normalized)) {
    return { stage: 'model_not_found', status: 422, upstreamStatus, retryable: false, message };
  }
  if (upstreamStatus === 429 || /rate limit|too many requests|requests per minute|tokens per minute/.test(normalized)) {
    return { stage: 'rate_limit', status: 429, upstreamStatus, retryable: true, message };
  }
  if (upstreamStatus === 400 || /invalid request|bad request|validation failed|malformed/.test(normalized)) {
    return { stage: 'invalid_request', status: 422, upstreamStatus, retryable: false, message };
  }
  if (upstreamStatus !== undefined && upstreamStatus >= 500) {
    return { stage: 'service_unavailable', status: 502, upstreamStatus, retryable: true, message };
  }
  if (/econn|enotfound|network|fetch failed|socket|dns|certificate|tls/.test(normalized)) {
    return { stage: 'network', status: 503, upstreamStatus, retryable: true, message };
  }
  return { stage: 'unknown', status: 502, upstreamStatus, retryable: false, message };
}

export function upstreamAppError(
  domain: UpstreamDomain,
  service: string,
  error: unknown
): AppError {
  if (error instanceof AppError) return error;
  const classified = classifyUpstreamError(error);
  const details: UpstreamErrorDetails = {
    domain,
    service,
    stage: classified.stage,
    ...(classified.upstreamStatus !== undefined ? { upstreamStatus: classified.upstreamStatus } : {}),
    providerMessage: classified.message,
    retryable: classified.retryable
  };
  return new AppError(
    `${domain}_${classified.stage}`,
    classified.status,
    classified.message,
    details
  );
}
