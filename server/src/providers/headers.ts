import { AppError } from '../errors.js';
import type { ProviderDefinition } from './types.js';

const blockedHeaders = new Set([
  'authorization',
  'proxy-authorization',
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-goog-api-key'
]);

export function normalizeCustomHeaders(
  definition: ProviderDefinition,
  input: Record<string, string> | undefined
): Readonly<Record<string, string>> {
  if (!input) return Object.freeze({});
  const allowed = new Set(definition.allowedCustomHeaders.map((header) => header.toLowerCase()));
  const output: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim();
    const lower = name.toLowerCase();
    if (!name || blockedHeaders.has(lower)) {
      throw new AppError('provider_custom_header_forbidden', 422, `Custom header ${name || '(empty)'} is not allowed.`, {
        stage: 'configuration', retryable: false
      });
    }
    if (!allowed.has(lower)) {
      throw new AppError('provider_custom_header_unsupported', 422, `Custom header ${name} is not supported for this provider.`, {
        stage: 'configuration', retryable: false
      });
    }
    const value = rawValue.trim();
    if (!value || /[\r\n]/.test(value)) {
      throw new AppError('provider_custom_header_invalid', 422, `Custom header ${name} has an invalid value.`, {
        stage: 'configuration', retryable: false
      });
    }
    output[name] = value;
  }
  return Object.freeze(output);
}

export function providerRequestHeaders(
  definition: ProviderDefinition,
  apiKey: string,
  customHeaders: Readonly<Record<string, string>>,
  accept = 'application/json'
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'Content-Type': 'application/json',
    ...definition.defaultHeaders,
    ...customHeaders
  };
  if (definition.authentication === 'bearer' && apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (definition.authentication === 'x-api-key' && apiKey) headers['x-api-key'] = apiKey;
  if (definition.authentication === 'google-api-key' && apiKey) headers['x-goog-api-key'] = apiKey;
  if (definition.id === 'openrouter') {
    headers['HTTP-Referer'] = process.env.APP_URL || 'https://moataz.ai';
    headers['X-Title'] = 'Moataz AI';
  }
  return headers;
}
