import { describe, expect, it } from 'vitest';
import { getProviderDefinition } from '../providers/index.js';
import { normalizeCustomHeaders, providerRequestHeaders } from './headers.js';

describe('provider headers', () => {
  it('sets Bearer authorization from the decrypted server-side credential', () => {
    const definition = getProviderDefinition('nararouter');
    const headers = providerRequestHeaders(definition, 'secret-value', {});
    expect(headers.Authorization).toBe('Bearer secret-value');
  });

  it('rejects custom headers that could replace authentication or transport headers', () => {
    const definition = getProviderDefinition('custom');
    expect(() => normalizeCustomHeaders(definition, { Authorization: 'Bearer attacker' })).toThrow(/not allowed/i);
    expect(() => normalizeCustomHeaders(definition, { Host: 'internal.local' })).toThrow(/not allowed/i);
    expect(() => normalizeCustomHeaders(definition, { Cookie: 'session=x' })).toThrow(/not allowed/i);
  });

  it('accepts only provider-approved non-secret routing metadata', () => {
    const definition = getProviderDefinition('openrouter');
    expect(normalizeCustomHeaders(definition, { 'X-Title': 'Moataz AI' })).toEqual({ 'X-Title': 'Moataz AI' });
    expect(() => normalizeCustomHeaders(definition, { 'X-Unknown': 'value' })).toThrow(/not supported/i);
  });
});
