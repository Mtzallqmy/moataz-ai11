export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, code: string, details?: unknown, requestId?: string, message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export type ApiRequestOptions = RequestInit & { accessToken?: string };

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

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
    const root = objectRecord(data);
    const nested = objectRecord(root.error);
    const code = typeof nested.code === 'string'
      ? nested.code
      : typeof root.error === 'string'
        ? root.error
        : typeof root.code === 'string'
          ? root.code
          : 'request_failed';
    const requestId = typeof nested.requestId === 'string'
      ? nested.requestId
      : typeof root.requestId === 'string'
        ? root.requestId
        : response.headers.get('x-request-id') ?? undefined;
    const details = root.details !== undefined
      ? root.details
      : Object.keys(nested).length > 0
        ? nested
        : undefined;
    const message = typeof nested.message === 'string'
      ? nested.message
      : typeof root.message === 'string'
        ? root.message
        : code;
    throw new ApiError(response.status, code, details, requestId, message);
  }
  return data as T;
}
