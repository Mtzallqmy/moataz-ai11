import { describe, expect, it } from 'vitest';
import { normalizeEmail, signAccessToken, verifyAccessToken } from './auth.js';

describe('authentication helpers', () => {
  it('normalizes email addresses', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });

  it('signs and verifies a typed access token', () => {
    const token = signAccessToken({ id: 'user-1', email: 'user@example.com', name: 'User', role: 'user', isActive: true });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.type).toBe('access');
  });

  it('rejects malformed tokens', () => {
    expect(() => verifyAccessToken('not-a-token')).toThrow();
  });
});
