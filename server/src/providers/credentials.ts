import { AppError } from '../errors.js';

/**
 * Normalizes a provider credential without making assumptions about its prefix.
 * Only surrounding whitespace and one matching pair of outer quotes are removed.
 */
export function normalizeApiKey(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  const unquoted = trimmed.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2').trim();
  if (/\r|\n/.test(unquoted)) {
    throw new AppError('provider_api_key_invalid_format', 422, 'API keys cannot contain line breaks.', {
      stage: 'configuration', retryable: false
    });
  }
  return unquoted;
}
