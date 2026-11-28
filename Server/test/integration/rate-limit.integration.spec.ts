import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PASSWORD, freshIp, uniqueEmail, type ErrorPayload } from './helpers/client.js';
import { startStack, stopStack, type Stack } from './helpers/stack.js';

// Needs Docker. Limits from the brief §6: login 10 / 15 min per email and 30 / 15 min per IP,
// register 5 / hour per IP, nonce 30 / min per IP. (Refresh: refresh.integration.spec.ts.)

describe('rate limits', () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  /** A login from `ip`. The nonce comes from another address so the nonce limit stays out of it. */
  async function loginFrom(ip: string, email: string, password: string) {
    return stack.client.post(
      '/api/auth/login',
      {
        email,
        password,
        integrityToken: 'bypass-token',
        integrityNonce: await stack.client.nonce(),
      },
      { ip },
    );
  }

  async function registerFrom(ip: string) {
    return stack.client.post(
      '/api/auth/register',
      {
        displayName: 'Limit Test',
        email: uniqueEmail('limit'),
        password: DEFAULT_PASSWORD,
        integrityToken: 'bypass-token',
        integrityNonce: await stack.client.nonce(),
      },
      { ip },
    );
  }

  const expectRateLimited = (
    response: { status: number; headers: Record<string, unknown>; json: <T>() => T },
    maxRetryAfter: number,
  ) => {
    expect(response.status).toBe(429);
    expect(response.json<ErrorPayload>().error.code).toBe('rate_limited');
    const retryAfter = Number(response.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(maxRetryAfter);
  };

  it('login: 10 per 15 minutes per email, then 429 with Retry-After', async () => {
    const { email, password } = await stack.client.register();

    for (let attempt = 1; attempt <= 10; attempt++) {
      // Every attempt comes from a different address, so only the per-email limit can apply.
      const response = await loginFrom(freshIp(), email, `${password}-wrong`);
      expect(response.status, `attempt ${attempt}`).toBe(401);
    }

    const eleventh = await loginFrom(freshIp(), email, `${password}-wrong`);
    expectRateLimited(eleventh, 15 * 60);

    // Locked out for everyone, including the right password: that is what the limit is for.
    expectRateLimited(await loginFrom(freshIp(), email, password), 15 * 60);

    // Another account is not affected.
    const other = await stack.client.register();
    expect((await loginFrom(freshIp(), other.email, other.password)).status).toBe(200);
  });

  it('the per-email limit is keyed on the normalised address', async () => {
    const { email, password } = await stack.client.register();
    for (let attempt = 1; attempt <= 10; attempt++) {
      await loginFrom(
        freshIp(),
        attempt % 2 === 0 ? email.toUpperCase() : ` ${email} `,
        'wrong-password-1',
      );
    }
    expectRateLimited(await loginFrom(freshIp(), email, password), 15 * 60);
  });

  it('login: 30 per 15 minutes per IP, then 429', async () => {
    const ip = freshIp();
    for (let attempt = 1; attempt <= 30; attempt++) {
      // A different (unknown) email each time, so only the per-IP limit can apply.
      const response = await loginFrom(ip, uniqueEmail('ghost'), 'wrong-password-1');
      expect(response.status, `attempt ${attempt}`).toBe(401);
    }
    expectRateLimited(await loginFrom(ip, uniqueEmail('ghost'), 'wrong-password-1'), 15 * 60);

    // A different address is unaffected.
    const { email, password } = await stack.client.register();
    expect((await loginFrom(freshIp(), email, password)).status).toBe(200);
  });

  it('register: 5 per hour per IP, then 429', async () => {
    const ip = freshIp();
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await registerFrom(ip)).status, `attempt ${attempt}`).toBe(201);
    }
    expectRateLimited(await registerFrom(ip), 60 * 60);
    expect((await registerFrom(freshIp())).status).toBe(201);
  });

  it('nonce: 30 per minute per IP, then 429', async () => {
    const ip = freshIp();
    for (let attempt = 1; attempt <= 30; attempt++) {
      expect((await stack.client.get('/api/integrity/nonce', { ip })).status).toBe(200);
    }
    expectRateLimited(await stack.client.get('/api/integrity/nonce', { ip }), 60);
    expect((await stack.client.get('/api/integrity/nonce', { ip: freshIp() })).status).toBe(200);
  });

  it('a limited request is refused before anything else happens (no nonce used up, no account made)', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await registerFrom(ip);
    const email = uniqueEmail('blocked');
    const nonce = await stack.client.nonce();
    const blocked = await stack.client.post(
      '/api/auth/register',
      {
        displayName: 'Blocked',
        email,
        password: DEFAULT_PASSWORD,
        integrityToken: 'bypass-token',
        integrityNonce: nonce,
      },
      { ip },
    );
    expect(blocked.status).toBe(429);
    expect(await stack.prisma.user.count({ where: { email } })).toBe(0);
    // The nonce is still valid: the same body works from another address.
    const retry = await stack.client.post(
      '/api/auth/register',
      {
        displayName: 'Blocked',
        email,
        password: DEFAULT_PASSWORD,
        integrityToken: 'bypass-token',
        integrityNonce: nonce,
      },
      { ip: freshIp() },
    );
    expect(retry.status).toBe(201);
  });

  it('the window ends: after the key expires the same IP is allowed again', async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i++) await stack.client.get('/api/integrity/nonce', { ip });
    expect((await stack.client.get('/api/integrity/nonce', { ip })).status).toBe(429);

    const [key] = await stack.redisClient.keys(`rl:nonce:ip:${ip}`);
    expect(key).toBeDefined();
    await stack.redisClient.pexpire(key ?? '', 1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect((await stack.client.get('/api/integrity/nonce', { ip })).status).toBe(200);
  });

  it('every rate-limit key has a TTL (rule: no Redis key without one)', async () => {
    const keys = await stack.redisClient.keys('rl:*');
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      const ttl = await stack.redisClient.ttl(key);
      expect(ttl, key).toBeGreaterThan(0);
    }
  });

  it('keys hold a hash of the email, never the address', async () => {
    const { email } = await stack.client.register();
    await loginFrom(freshIp(), email, 'wrong-password-1');
    const keys = (await stack.redisClient.keys('*')).join('\n');
    expect(keys).not.toContain(email);
    expect(keys).not.toContain(email.split('@')[0] ?? 'x');
  });

  describe('which address counts', () => {
    it('ignores X-Forwarded-For unless a proxy is trusted (a client cannot pick its own IP)', async () => {
      const ip = freshIp();
      for (let i = 0; i < 30; i++) {
        await stack.client.get('/api/integrity/nonce', {
          ip,
          headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
        });
      }
      const blocked = await stack.client.get('/api/integrity/nonce', {
        ip,
        headers: { 'x-forwarded-for': '198.51.100.99' },
      });
      expect(blocked.status).toBe(429);
    });

    it('an IPv4-mapped IPv6 address is the same client as its IPv4 address', async () => {
      const v4 = freshIp();
      for (let i = 0; i < 30; i++) await stack.client.get('/api/integrity/nonce', { ip: v4 });
      const mapped = await stack.client.get('/api/integrity/nonce', { ip: `::ffff:${v4}` });
      expect(mapped.status).toBe(429);
    });

    it('every address of one IPv6 /64 shares one limit', async () => {
      for (let i = 0; i < 30; i++) {
        const response = await stack.client.get('/api/integrity/nonce', {
          ip: `2001:db8:77:42::${(i + 1).toString(16)}`,
        });
        expect(response.status).toBe(200);
      }
      const another = await stack.client.get('/api/integrity/nonce', {
        ip: '2001:db8:77:42:dead:beef:0:1',
      });
      expect(another.status).toBe(429);
      const otherNetwork = await stack.client.get('/api/integrity/nonce', {
        ip: '2001:db8:77:43::1',
      });
      expect(otherNetwork.status).toBe(200);
    });
  });
});
