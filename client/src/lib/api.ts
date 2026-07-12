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

async function errorFromResponse(response: Response): Promise<ApiError> {
  let data: unknown = {};
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try { data = await response.json(); } catch { data = {}; }
  } else {
    try { data = { message: (await response.text()).slice(0, 1000) }; } catch { data = {}; }
  }
  const record = data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const code = typeof record.error === 'string' ? record.error : 'request_failed';
  const requestId = typeof record.requestId === 'string' ? record.requestId : response.headers.get('x-request-id') ?? undefined;
  return new ApiError(response.status, code, record.details ?? record, requestId);
}

export async function apiResponse(path: string, options: ApiRequestOptions = {}): Promise<Response> {
  const { accessToken, headers, ...rest } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(rest.body !== undefined && !(rest.body instanceof FormData) && !(rest.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
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
  if (!response.ok) throw await errorFromResponse(response);
  return response;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await apiResponse(path, options);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return {} as T;
  try {
    return await response.json() as T;
  } catch {
    return {} as T;
  }
}
