import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('Express proxy and rate-limit configuration', () => {
  it('accepts X-Forwarded-For behind the configured trusted proxy', async () => {
    const app = createApp();
    expect(app.get('trust proxy')).toBe(1);

    const response = await request(app)
      .get('/api/unknown')
      .set('X-Forwarded-For', '203.0.113.10');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'api_not_found' });
    expect(response.headers['ratelimit-policy']).toBeDefined();
  });

  it('does not apply user API quotas to Railway probe endpoints', async () => {
    const app = createApp();
    const response = await request(app)
      .get('/api/health')
      .set('X-Forwarded-For', '203.0.113.11');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, status: 'alive' });
    expect(response.headers['ratelimit-policy']).toBeUndefined();
  });
});
