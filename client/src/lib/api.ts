export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, code: string, details?: unknown, requestId?: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export type ApiRequestOptions = RequestInit & { accessToken?: string };

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { accessToken, headers, ...rest } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(rest.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers
      }
    });
  } catch (error) {
    throw new ApiError(0, 'network_error', {
      providerMessage: error instanceof Error ? error.message : String(error),
      retryable: true
    });
  }

  let data: unknown = {};
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const record = data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const nestedError = record.error !== null && typeof record.error === 'object' && !Array.isArray(record.error)
      ? record.error as Record<string, unknown>
      : undefined;
    const code = typeof record.error === 'string'
      ? record.error
      : typeof nestedError?.code === 'string'
        ? nestedError.code
        : 'request_failed';
    const requestId = typeof record.requestId === 'string'
      ? record.requestId
      : typeof nestedError?.requestId === 'string'
        ? nestedError.requestId
        : response.headers.get('x-request-id') ?? undefined;
    const details = record.details ?? (nestedError ? { providerMessage: nestedError.message, suggestion: nestedError.messageAr, retryable: nestedError.retryable } : undefined);
    throw new ApiError(response.status, code, details, requestId);
  }
  return data as T;
}
