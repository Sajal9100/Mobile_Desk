import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PASSWORD, uniqueEmail, type ErrorPayload } from './helpers/client.js';
import { startStack, stopStack, waitFor, type Stack } from './helpers/stack.js';

// Needs Docker. Rule 9: when a check cannot be completed, deny the action and answer with a
// retryable error. Never "allow on error", and never a bare 500 that looks like a bug.

const codeOf = (response: { json: <T>() => T }) => response.json<ErrorPayload>().error.code;

describe('Redis is down', () => {
  let stack: Stack;
  let signedUp: Awaited<ReturnType<Stack['client']['signUp']>>;
  beforeAll(async () => {
    stack = await startStack();
    signedUp = await stack.client.signUp();
    await stack.redis.stop({ remove: false });
    await waitFor(
      () => stack.client.get('/ready'),
      (response) => response.status === 503,
    );
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  const ANY_NONCE = 'A'.repeat(43);

  it('login is denied with 503 service_unavailable (the rate limiter cannot answer)', async () => {
    const response = await stack.client.post('/api/auth/login', {
      email: signedUp.user.email,
      password: signedUp.password,
      integrityToken: 'bypass-token',
      integrityNonce: ANY_NONCE,
    });
    expect(response.status).toBe(503);
    expect(codeOf(response)).toBe('service_unavailable');
    expect(response.text).not.toContain('accessToken');
  });

  it('register is denied and creates nothing', async () => {
    const email = uniqueEmail('redis-down');
    const response = await stack.client.post('/api/auth/register', {
      displayName: 'Nobody',
      email,
      password: DEFAULT_PASSWORD,
      integrityToken: 'bypass-token',
      integrityNonce: ANY_NONCE,
    });
    expect(response.status).toBe(503);
    expect(await stack.prisma.user.count({ where: { email } })).toBe(0);
  });

  it('the nonce endpoint is denied', async () => {
    expect((await stack.client.get('/api/integrity/nonce')).status).toBe(503);
  });

  it('a refresh is denied, and the token is NOT consumed', async () => {
    const before = await stack.prisma.refreshToken.count({ where: { userId: signedUp.user.id } });
    const response = await stack.client.refresh(signedUp.refreshToken);
    expect(response.status).toBe(503);
    expect(codeOf(response)).toBe('service_unavailable');
    expect(await stack.prisma.refreshToken.count({ where: { userId: signedUp.user.id } })).toBe(
      before,
    );
  });

  it('account deletion is denied and deletes nothing', async () => {
    const response = await stack.client.delete(
      '/api/account',
      { password: signedUp.password },
      { token: signedUp.accessToken },
    );
    expect(response.status).toBe(503);
    const row = await stack.prisma.user.findUniqueOrThrow({ where: { id: signedUp.user.id } });
    expect(row.deletedAt).toBeNull();
  });

  it('a signed-in user can still be recognised: the cache is only an optimisation, the database decides', async () => {
    const response = await stack.client.get('/api/me', { token: signedUp.accessToken });
    expect(response.status).toBe(200);
  });

  it('a token for a suspended user is still refused while Redis is down', async () => {
    await stack.prisma.user.update({
      where: { id: signedUp.user.id },
      data: { status: 'suspended' },
    });
    try {
      const response = await stack.client.get('/api/me', { token: signedUp.accessToken });
      expect(response.status).toBe(401);
    } finally {
      await stack.prisma.user.update({
        where: { id: signedUp.user.id },
        data: { status: 'active' },
      });
    }
  });

  it('logout needs no Redis and still works (revoking must not depend on a cache)', async () => {
    const other = await stack.prisma.user.findUniqueOrThrow({ where: { id: signedUp.user.id } });
    expect(other.id).toBe(signedUp.user.id);
    const response = await stack.client.logout(signedUp.refreshToken);
    expect(response.status).toBe(204);
    const rows = await stack.prisma.refreshToken.findMany({ where: { userId: signedUp.user.id } });
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });
});

describe('Postgres is down', () => {
  let stack: Stack;
  let signedUp: Awaited<ReturnType<Stack['client']['signUp']>>;
  let freshNonce: string;
  beforeAll(async () => {
    stack = await startStack();
    signedUp = await stack.client.signUp();
    freshNonce = await stack.client.nonce();
    // Warm the user-status cache, so both the cached and the uncached path can be tested.
    expect((await stack.client.get('/api/me', { token: signedUp.accessToken })).status).toBe(200);
    await stack.postgres.stop({ remove: false });
    await waitFor(
      () => stack.client.get('/ready'),
      (response) => response.status === 503,
    );
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  it('a request with a valid token is 503, whether or not the status was cached', async () => {
    // Cached "active": the guard passes, the handler's own query fails.
    expect(await stack.redisClient.get(`user-status:${signedUp.user.id}`)).toBe('active');
    const cached = await stack.client.get('/api/me', { token: signedUp.accessToken });
    expect(cached.status).toBe(503);
    expect(codeOf(cached)).toBe('service_unavailable');

    // Not cached: the guard itself cannot decide, so it denies.
    await stack.redisClient.del(`user-status:${signedUp.user.id}`);
    const uncached = await stack.client.get('/api/me', { token: signedUp.accessToken });
    expect(uncached.status).toBe(503);
    expect(codeOf(uncached)).toBe('service_unavailable');
  });

  it('login, register and refresh answer 503, never 500 and never an accidental success', async () => {
    const login = await stack.client.post('/api/auth/login', {
      email: signedUp.user.email,
      password: signedUp.password,
      integrityToken: 'bypass-token',
      integrityNonce: freshNonce,
    });
    expect(login.status).toBe(503);
    expect(codeOf(login)).toBe('service_unavailable');

    const register = await stack.client.post('/api/auth/register', {
      displayName: 'Nobody',
      email: uniqueEmail('db-down'),
      password: DEFAULT_PASSWORD,
      integrityToken: 'bypass-token',
      integrityNonce: await stack.client.nonce(),
    });
    expect(register.status).toBe(503);

    const refresh = await stack.client.refresh(signedUp.refreshToken);
    expect(refresh.status).toBe(503);
    expect(refresh.text).not.toContain('refreshToken');
  });

  it('the health probe stays alive while readiness reports the outage', async () => {
    expect((await stack.client.get('/health')).status).toBe(200);
    expect((await stack.client.get('/ready')).status).toBe(503);
  });
});
