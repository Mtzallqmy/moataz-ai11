import { describe, expect, it } from 'vitest';
import { allowedChatIds, mergeDiscoveredChatMeta, telegramAllowsChat } from './telegram.js';

describe('Telegram chat authorization', () => {
  it('allows only configured chat identifiers', () => {
    const allowed = allowedChatIds({ allowedChatIds: ['100', 200] });
    expect(allowed.has('100')).toBe(true);
    expect(allowed.has('200')).toBe(true);
    expect(allowed.has('999')).toBe(false);
  });

  it('defaults to discovery-only deny and supports explicit allow-all', () => {
    expect(telegramAllowsChat({}, '100')).toBe(false);
    expect(telegramAllowsChat({ allowAllChats: true }, '100')).toBe(true);
  });

  it('records discovered chats without losing existing settings', () => {
    const meta = mergeDiscoveredChatMeta(
      { allowedChatIds: ['100'], identity: { username: 'bot' }, discoveredChats: [{ id: '200', title: 'Old' }] },
      { id: '300', type: 'private', title: 'New', lastSeenAt: '2026-07-11T00:00:00.000Z' }
    );
    expect(meta.allowedChatIds).toEqual(['100']);
    expect(meta.identity).toEqual({ username: 'bot' });
    expect(meta.discoveredChats).toEqual(expect.arrayContaining([expect.objectContaining({ id: '300' }), expect.objectContaining({ id: '200' })]));
  });
});
