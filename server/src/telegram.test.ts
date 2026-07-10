import { describe, expect, it } from 'vitest';
import { allowedChatIds } from './telegram.js';

describe('Telegram chat authorization', () => {
  it('allows only configured chat identifiers', () => {
    const allowed = allowedChatIds({ allowedChatIds: ['100', 200] });
    expect(allowed.has('100')).toBe(true);
    expect(allowed.has('200')).toBe(true);
    expect(allowed.has('999')).toBe(false);
  });

  it('defaults to deny when no chat identifier is configured', () => {
    expect(allowedChatIds({}).size).toBe(0);
  });
});
