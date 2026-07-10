import { describe, expect, it } from 'vitest';
import { buildAgentMessages, categorizeProviderError, parseLegacyToolCall } from './routes.js';

describe('chat and provider helpers', () => {
  it('adds the current user message exactly once', () => {
    const messages = buildAgentMessages([{ role: 'assistant', content: 'previous' }], 'current', 'system');
    expect(messages.filter((message) => message.role === 'user' && message.content === 'current')).toHaveLength(1);
  });

  it('parses only registered legacy tools', () => {
    expect(parseLegacyToolCall('```tool\n{"name":"read_file","args":{"path":"a"}}\n```')).toEqual({ name: 'read_file', args: { path: 'a' } });
    expect(parseLegacyToolCall('```tool\n{"name":"unknown","args":{}}\n```')).toBeNull();
  });

  it('maps provider authentication errors', () => {
    expect(categorizeProviderError('401 invalid api key').stage).toBe('authentication');
  });
});
