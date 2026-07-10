import { describe, expect, it } from 'vitest';
import { buildAgentMessages, categorizeProviderError, normalizeIntegrationToken, parseLegacyToolCall } from './routes.js';

describe('chat and provider helpers', () => {
  it('adds the current user message exactly once', () => {
    const messages = buildAgentMessages([{ role: 'assistant', content: 'previous' }], 'current', 'system');
    expect(messages.filter((message) => message.role === 'user' && message.content === 'current')).toHaveLength(1);
  });

  it('parses only registered legacy tools', () => {
    expect(parseLegacyToolCall('```tool\n{"name":"read_file","args":{"path":"a"}}\n```')).toEqual({ name: 'read_file', args: { path: 'a' } });
    expect(parseLegacyToolCall('```tool\n{"name":"unknown","args":{}}\n```')).toBeNull();
  });

  it('maps real provider billing and authentication errors', () => {
    expect(categorizeProviderError('401 invalid api key').stage).toBe('authentication');
    expect(categorizeProviderError('402 This request requires more credits').stage).toBe('billing');
  });

  it('normalizes valid bot tokens and rejects placeholders', () => {
    expect(normalizeIntegrationToken('telegram', ' 123456789:abcdefghijklmnopqrstuvwxyz_ABC123 ')).toBe('123456789:abcdefghijklmnopqrstuvwxyz_ABC123');
    expect(() => normalizeIntegrationToken('telegram', '[YOUR-BOT-TOKEN]')).toThrow(/format/i);
  });
});
