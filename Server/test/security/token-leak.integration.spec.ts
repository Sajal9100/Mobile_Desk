import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  POSTGRES_PASSWORD,
  REDIS_PASSWORD,
  startStack,
  stopStack,
  type Stack,
} from '../integration/helpers/stack.js';
import {
  freshIp,
  uniqueEmail,
  type ApiResponse,
  type AuthPayload,
  type RequestOptions,
} from '../integration/helpers/client.js';

// Needs Docker. Rule 8: never log passwords, tokens, refresh tokens or integrity tokens. This test
// runs the whole account lifecycle at TRACE level and then looks for every secret it used, in the
// logs, in later responses, in Postgres and in Redis.

const INTEGRITY_TOKEN = 'INTEGRITY_TOKEN_SENTINEL_2c9e41ab70';
const PASSWORD = 'Sentinel-Pa55word-XYZ';
const WRONG_PASSWORD = 'Sentinel-Wr0ng-Password-QQQ';
const WEAK_PASSWORD = 'WeakSentinel1'; // fails nothing but is unique; used in a rejected body

type Transcript = { label: string; response: ApiResponse };

describe('secrets never leak', () => {
  let stack: Stack;
  const transcript: Transcript[] = [];
  const secrets = new Map<string, string>(); // value -> what it is
  const issuedBy = new Map<string, string>(); // refresh/access token value -> label of its response

  beforeAll(async () => {
    stack = await startStack({ captureLogs: true });
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  async function call(
    label: string,
    method: string,
    url: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse> {
    const response = await stack.client.request(method, url, options);
    transcript.push({ label, response });
    return response;
  }

  async function nonce(): Promise<string> {
    const value = await stack.client.nonce(freshIp());
    secrets.set(value, 'integrity nonce');
    return value;
  }

  function remember(label: string, response: ApiResponse): AuthPayload {
    const body = response.json<AuthPayload>();
    secrets.set(body.refreshToken, `refresh token (${label})`);
    secrets.set(body.accessToken, `access token (${label})`);
    issuedBy.set(body.refreshToken, label);
    issuedBy.set(body.accessToken, label);
    return body;
  }

  it('runs the whole lifecycle', async () => {
    const email = uniqueEmail('leak');
    secrets.set(PASSWORD, 'password');
    secrets.set(WRONG_PASSWORD, 'wrong password');
    secrets.set(WEAK_PASSWORD, 'rejected password');
    secrets.set(INTEGRITY_TOKEN, 'integrity token');
    secrets.set(email, 'email address');
    secrets.set(REDIS_PASSWORD, 'redis password');
    secrets.set(POSTGRES_PASSWORD, 'postgres password');
    secrets.set(stack.jwtKeys.privatePem.split('\n')[1] ?? 'x', 'JWT private key');

    const body = (extra: Record<string, unknown>) => ({
      integrityToken: INTEGRITY_TOKEN,
      ...extra,
    });

    // A registration that is rejected, with a password in the body.
    await call('register (rejected)', 'POST', '/api/auth/register', {
      body: body({
        displayName: 'Leak Test',
        email,
        password: WEAK_PASSWORD.slice(0, 5),
        integrityNonce: await nonce(),
        unexpected: WEAK_PASSWORD,
      }),
      ip: freshIp(),
    });

    const registered = remember(
      'register',
      await call('register', 'POST', '/api/auth/register', {
        body: body({
          displayName: 'Leak Test',
          email,
          password: PASSWORD,
          integrityNonce: await nonce(),
        }),
        ip: freshIp(),
      }),
    );
    await call('me', 'GET', '/api/me', { token: registered.accessToken });

    // Wrong passwords, an unknown email, a replayed nonce.
    await call('login (wrong password)', 'POST', '/api/auth/login', {
      body: body({ email, password: WRONG_PASSWORD, integrityNonce: await nonce() }),
      ip: freshIp(),
    });
    await call('login (unknown email)', 'POST', '/api/auth/login', {
      body: body({
        email: uniqueEmail('ghost'),
        password: WRONG_PASSWORD,
        integrityNonce: await nonce(),
      }),
      ip: freshIp(),
    });
    await call('login (bad nonce)', 'POST', '/api/auth/login', {
      body: body({ email, password: PASSWORD, integrityNonce: 'Z'.repeat(43) }),
      ip: freshIp(),
    });

    const loggedIn = remember(
      'login',
      await call('login', 'POST', '/api/auth/login', {
        body: body({ email, password: PASSWORD, integrityNonce: await nonce() }),
        ip: freshIp(),
      }),
    );

    // Rotation, then a reuse alarm with the stolen token.
    const refreshed = remember(
      'refresh',
      await call('refresh', 'POST', '/api/auth/refresh', {
        body: { refreshToken: loggedIn.refreshToken },
      }),
    );
    await call('refresh (reuse)', 'POST', '/api/auth/refresh', {
      body: { refreshToken: loggedIn.refreshToken },
    });
    await call('refresh (revoked)', 'POST', '/api/auth/refresh', {
      body: { refreshToken: refreshed.refreshToken },
    });

    // Another session: logout, then account deletion with a wrong and the right password.
    const second = remember(
      'login 2',
      await call('login 2', 'POST', '/api/auth/login', {
        body: body({ email, password: PASSWORD, integrityNonce: await nonce() }),
        ip: freshIp(),
      }),
    );
    await call('logout', 'POST', '/api/auth/logout', {
      body: { refreshToken: second.refreshToken },
    });
    await call('delete (wrong password)', 'DELETE', '/api/account', {
      body: { password: WRONG_PASSWORD },
      token: registered.accessToken,
    });
    await call('delete', 'DELETE', '/api/account', {
      body: { password: PASSWORD },
      token: registered.accessToken,
    });
    await call('me (after deletion)', 'GET', '/api/me', { token: registered.accessToken });

    // Something the server does not expect: a 404 whose URL carries a secret-looking query.
    await call('unknown route', 'GET', `/api/nope?ticket=${registered.accessToken}`);

    const hash = (
      await stack.prisma.user.findUniqueOrThrow({
        where: { email },
        select: { passwordHash: true },
      })
    ).passwordHash;
    secrets.set(hash, 'password hash');

    expect(secrets.size).toBeGreaterThan(15);
    expect(transcript.length).toBeGreaterThan(15);
  });

  it('no log line contains a password, token, nonce, email, hash or key', () => {
    const logs = stack.logText();
    expect(logs.length).toBeGreaterThan(1_000); // the capture really captured (trace level)
    expect(logs).toContain('"audit":true'); // ...including the audit lines
    const leaked = [...secrets].filter(([value]) => logs.includes(value)).map(([, what]) => what);
    expect(leaked).toEqual([]);
  });

  it('a request line carries the path only: the query string and the Authorization header are gone', () => {
    const logs = stack.logText();
    expect(logs).not.toContain('ticket=');
    expect(logs).not.toMatch(/"authorization"\s*:\s*"Bearer/i);
    expect(logs).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/);
  });

  it('a token appears in the response that issued it and in no other response', () => {
    const offenders: string[] = [];
    for (const [token, issuer] of issuedBy) {
      for (const { label, response } of transcript) {
        if (label !== issuer && response.text.includes(token)) {
          offenders.push(`${issuer} token found in the response of "${label}"`);
        }
      }
    }
    expect(issuedBy.size).toBeGreaterThanOrEqual(8);
    expect(offenders).toEqual([]);
  });

  it('error responses never echo what the caller sent', () => {
    const echoed = transcript
      .filter(({ response }) => response.status >= 400)
      .flatMap(({ label, response }) =>
        [PASSWORD, WRONG_PASSWORD, WEAK_PASSWORD, INTEGRITY_TOKEN]
          .filter((secret) => response.text.includes(secret))
          .map((secret) => `${label} echoed ${secret.slice(0, 12)}...`),
      );
    expect(echoed).toEqual([]);
  });

  it('Postgres holds hashes only: no raw refresh token or password in any column', async () => {
    const rows = JSON.stringify([
      await stack.prisma.$queryRaw`SELECT * FROM refresh_tokens`,
      await stack.prisma.$queryRaw`SELECT * FROM users`,
      await stack.prisma.$queryRaw`SELECT * FROM user_settings`,
    ]);
    const leaked = [...secrets]
      .filter(
        ([value, what]) =>
          what !== 'email address' && what !== 'password hash' && rows.includes(value),
      )
      .map(([, what]) => what);
    expect(leaked).toEqual([]);
  });

  it('Redis holds no raw token or password, as a key or as a value', async () => {
    const keys = await stack.redisClient.keys('*');
    const entries: string[] = [...keys];
    for (const key of keys) {
      if ((await stack.redisClient.type(key)) === 'string') {
        entries.push((await stack.redisClient.get(key)) ?? '');
      }
    }
    const dump = entries.join('\n');
    const leaked = [...secrets]
      .filter(([, what]) => what !== 'redis password' && what !== 'integrity nonce')
      .filter(([value]) => dump.includes(value))
      .map(([, what]) => what);
    expect(leaked).toEqual([]);
  });
});
