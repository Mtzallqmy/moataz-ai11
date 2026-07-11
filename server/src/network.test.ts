import { describe, expect, it } from 'vitest';
import { assertSafeOutboundUrl, htmlToText, isPrivateOrReservedIp } from './network.js';

describe('outbound network guard', () => {
  it('blocks private and reserved addresses', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.1.2.3')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.2')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
  });

  it('rejects localhost and URL credentials', async () => {
    await expect(assertSafeOutboundUrl('http://localhost:8080')).rejects.toMatchObject({ code: 'private_network_url_not_allowed' });
    await expect(assertSafeOutboundUrl('https://user:pass@example.com')).rejects.toMatchObject({ code: 'url_credentials_not_allowed' });
  });

  it('extracts readable text without scripts or styles', () => {
    const text = htmlToText('<style>.x{}</style><script>alert(1)</script><h1>Hello &amp; world</h1>');
    expect(text).toBe('Hello & world');
  });
});
