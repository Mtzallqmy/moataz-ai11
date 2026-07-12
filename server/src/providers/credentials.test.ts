import { describe, expect, it } from 'vitest';
import { normalizeApiKey } from './credentials.js';

describe('provider credential normalization', () => {
  it('removes surrounding whitespace and matching outer quotes without checking a prefix', () => {
    expect(normalizeApiKey('  "sk-nry-example-7XqA"  ')).toBe('sk-nry-example-7XqA');
    expect(normalizeApiKey("  'arbitrary-provider-token'  ")).toBe('arbitrary-provider-token');
  });

  it('rejects line breaks that could corrupt request headers', () => {
    expect(() => normalizeApiKey('key\r\nInjected: value')).toThrow(/line breaks/i);
  });
});
