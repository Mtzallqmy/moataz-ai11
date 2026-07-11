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

type ClassifiedUpstreamError = {
  stage: UpstreamStage;
  status: number;
  upstreamStatus?: number;
  retryable: boolean;
  message: string;
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
  const nestedError = record(body?.error);
  const candidates = [
    nestedError?.message,
    nestedError?.detail,
    root?.message,
    body?.message,
    body?.description,
    body?.detail,
    typeof body?.error === 'string' ? body.error : undefined,
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

function classified(
  stage: UpstreamStage,
  status: number,
  retryable: boolean,
  message: string,
  upstreamStatus: number | undefined
): ClassifiedUpstreamError {
  return {
    stage,
    status,
    retryable,
    message,
    ...(upstreamStatus !== undefined ? { upstreamStatus } : {})
  };
}

export function classifyUpstreamError(error: unknown): ClassifiedUpstreamError {
  const upstreamStatus = numericStatus(error);
  const message = upstreamMessage(error);
  const normalized = message.toLowerCase();

  if (/abort|timeout|timed out|deadline exceeded/.test(normalized)) {
    return classified('timeout', 504, true, message, upstreamStatus);
  }
  if (upstreamStatus === 401 || /unauthorized|invalid (api )?key|incorrect (api )?key|invalid token|token is invalid|api key not valid/.test(normalized)) {
    return classified('authentication', 422, false, message, upstreamStatus);
  }
  if (upstreamStatus === 402 || /payment required|insufficient credits?|not enough credits?|requires? more credits?|billing|quota exceeded|credit balance/.test(normalized)) {
    return classified('billing', 402, false, message, upstreamStatus);
  }
  if (upstreamStatus === 403 || /forbidden|permission denied|insufficient scope|not allowed|access denied/.test(normalized)) {
    return classified('authorization', 422, false, message, upstreamStatus);
  }
  if (upstreamStatus === 404 || /model.*not found|unknown model|no such model|does not exist|invalid model/.test(normalized)) {
    return classified('model_not_found', 422, false, message, upstreamStatus);
  }
  if (upstreamStatus === 429 || /rate limit|too many requests|requests per minute|tokens per minute|capacity/.test(normalized)) {
    return classified('rate_limit', 429, true, message, upstreamStatus);
  }
  if (
    upstreamStatus === 400
    || upstreamStatus === 409
    || upstreamStatus === 415
    || upstreamStatus === 422
    || /invalid request|bad request|validation failed|malformed|invalid url|only absolute urls|failed to parse url|unsupported protocol|base url/.test(normalized)
  ) {
    return classified('invalid_request', 422, false, message, upstreamStatus);
  }
  if (upstreamStatus !== undefined && upstreamStatus >= 500) {
    return classified('service_unavailable', 502, true, message, upstreamStatus);
  }
  if (/econn|enotfound|network|fetch failed|socket|dns|certificate|tls|connection refused/.test(normalized)) {
    return classified('network', 503, true, message, upstreamStatus);
  }
  return classified('unknown', 502, false, message, upstreamStatus);
}

export function upstreamAppError(
  domain: UpstreamDomain,
  service: string,
  error: unknown
): AppError {
  if (error instanceof AppError) return error;
  const mapped = classifyUpstreamError(error);
  const details: UpstreamErrorDetails = {
    domain,
    service,
    stage: mapped.stage,
    ...(mapped.upstreamStatus !== undefined ? { upstreamStatus: mapped.upstreamStatus } : {}),
    providerMessage: mapped.message,
    retryable: mapped.retryable
  };
  return new AppError(
    `${domain}_${mapped.stage}`,
    mapped.status,
    mapped.message,
    details
  );
}
