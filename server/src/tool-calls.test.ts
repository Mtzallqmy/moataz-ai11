import { describe, expect, it } from 'vitest';
import { parseToolCalls } from './tool-calls.js';

describe('tool call normalization', () => {
  it('parses legacy string records into arrays', () => {
    const parsed = parseToolCalls(JSON.stringify([{ tool: { name: 'read_file', args: { path: 'a.txt' } }, result: 'ok' }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: 'read_file', status: 'succeeded', arguments: { path: 'a.txt' }, result: 'ok' });
  });

  it('always returns an array for invalid input', () => {
    expect(parseToolCalls('{bad json')).toEqual([]);
    expect(parseToolCalls(null)).toEqual([]);
  });

  it('redacts secrets from arguments and results', () => {
    const parsed = parseToolCalls([{ id: '1', name: 'x', arguments: { token: 'abc' }, status: 'succeeded', result: { apiKey: 'xyz' } }]);
    expect(parsed[0]?.arguments.token).toBe('[REDACTED]');
    expect((parsed[0]?.result as { apiKey: string }).apiKey).toBe('[REDACTED]');
  });
});
