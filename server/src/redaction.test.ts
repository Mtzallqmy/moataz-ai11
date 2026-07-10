import { describe, expect, it } from 'vitest';
import { redactSecrets, redactText } from './redaction.js';

describe('secret redaction', () => {
  it('redacts sensitive fields recursively', () => {
    expect(redactSecrets({ apiKey: 'secret', nested: { Authorization: 'Bearer abc' }, safe: 'ok' })).toEqual({
      apiKey: '[REDACTED]', nested: { Authorization: '[REDACTED]' }, safe: 'ok'
    });
  });

  it('redacts bearer tokens in text', () => {
    expect(redactText('Authorization: Bearer abc.def.ghi')).not.toContain('abc.def.ghi');
  });
});
