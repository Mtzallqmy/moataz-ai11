export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, details?: unknown) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ApiRequestOptions = RequestInit & { accessToken?: string };

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { accessToken, headers, ...rest } = options;
  const response = await fetch(path, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(rest.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers
    }
  });

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
    const code = typeof record.error === 'string' ? record.error : 'request_failed';
    throw new ApiError(response.status, code, record.details);
  }
  return data as T;
}
