import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/common/crypto.js';
import { AppException } from '../../src/common/errors/app.exception.js';
import type {
  DecodeResult,
  PlayIntegrityClient,
} from '../../src/modules/integrity/play-integrity.client.js';
import {
  MAX_TOKEN_AGE_MS,
  computeRequestHash,
  type IntegrityAction,
  type TokenPayload,
} from '../../src/modules/integrity/verdict.js';
import { TEST_CERT_SHA256, TEST_PACKAGE_NAME } from '../helpers/test-config.js';
import {
  DEFAULT_PASSWORD,
  freshIp,
  uniqueEmail,
  type ApiResponse,
  type ErrorPayload,
} from './helpers/client.js';
import { startStack, stopStack, type Stack } from './helpers/stack.js';

// Needs Docker. INTEGRITY_MODE=enforce with Google replaced by a mock: no test calls Google.

const PLAY_TOKEN = 'PLAY_INTEGRITY_TOKEN_SENTINEL_41d7';

/** Stands in for Google: records every token it is asked about and answers as the test says. */
class MockGoogle implements PlayIntegrityClient {
  calls: string[] = [];
  handler: (token: string) => Promise<DecodeResult> = () =>
    Promise.reject(new Error('no answer set'));

  decode(token: string): Promise<DecodeResult> {
    this.calls.push(token);
    return this.handler(token);
  }

  answer(payload: TokenPayload): void {
    this.handler = () => Promise.resolve({ kind: 'decoded', payload });
  }
}

function payloadFor(
  action: IntegrityAction,
  nonce: string,
  email: string,
  changes: {
    requestPackageName?: string;
    requestHash?: string;
    ageMs?: number;
    appRecognitionVerdict?: string;
    certDigestHex?: string;
    deviceRecognitionVerdict?: string[];
  } = {},
): TokenPayload {
  return {
    requestDetails: {
      requestPackageName: changes.requestPackageName ?? TEST_PACKAGE_NAME,
      requestHash: changes.requestHash ?? computeRequestHash(action, nonce, email),
      timestampMillis: String(Date.now() - (changes.ageMs ?? 1_000)),
    },
    appIntegrity: {
      appRecognitionVerdict: changes.appRecognitionVerdict ?? 'PLAY_RECOGNIZED',
      certificateSha256Digest: [
        Buffer.from(changes.certDigestHex ?? TEST_CERT_SHA256, 'hex').toString('base64url'),
      ],
    },
    deviceIntegrity: {
      deviceRecognitionVerdict: changes.deviceRecognitionVerdict ?? [
        'MEETS_BASIC_INTEGRITY',
        'MEETS_DEVICE_INTEGRITY',
      ],
    },
  };
}

describe('Play Integrity in enforce mode (Google mocked)', () => {
  const google = new MockGoogle();
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack({ integrityClient: google, captureLogs: true });
  });
  afterAll(async () => {
    await stopStack(stack);
  });
  beforeEach(() => {
    google.calls = [];
    google.handler = () => Promise.reject(new Error('no answer set'));
  });

  /** One register attempt the way the app makes it. `changes` breaks the token in one way. */
  async function attemptRegister(
    changes: Parameters<typeof payloadFor>[3] = {},
    body: Record<string, unknown> = {},
  ): Promise<{ response: ApiResponse; email: string; nonce: string }> {
    const ip = freshIp();
    const email = uniqueEmail('enforce');
    const nonce = await stack.client.nonce(ip);
    google.answer(payloadFor('register', nonce, email, changes));
    const response = await stack.client.post(
      '/api/auth/register',
      {
        displayName: 'Enforced',
        email,
        password: DEFAULT_PASSWORD,
        integrityToken: PLAY_TOKEN,
        integrityNonce: nonce,
        ...body,
      },
      { ip },
    );
    return { response, email, nonce };
  }

  async function attemptLogin(
    email: string,
    password: string,
    changes: Parameters<typeof payloadFor>[3] = {},
  ) {
    const ip = freshIp();
    const nonce = await stack.client.nonce(ip);
    google.answer(payloadFor('login', nonce, email, changes));
    return stack.client.post(
      '/api/auth/login',
      { email, password, integrityToken: PLAY_TOKEN, integrityNonce: nonce },
      { ip },
    );
  }

  const errorOf = (response: ApiResponse) => response.json<ErrorPayload>().error;

  describe('accepts a good token', () => {
    it("register and login succeed and each asks Google exactly once about the app's token", async () => {
      const { response, email } = await attemptRegister();
      expect(response.status).toBe(201);
      expect(google.calls).toEqual([PLAY_TOKEN]);

      google.calls = [];
      const login = await attemptLogin(email, DEFAULT_PASSWORD);
      expect(login.status).toBe(200);
      expect(google.calls).toEqual([PLAY_TOKEN]);
    });

    it('a nonce is 43 characters, fresh every time, and lives 5 minutes in Redis', async () => {
      const a = await stack.client.nonce();
      const b = await stack.client.nonce();
      expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(a).not.toBe(b);
      const ttl = await stack.redisClient.ttl(`integrity-nonce:${a}`);
      expect(ttl).toBeGreaterThan(290);
      expect(ttl).toBeLessThanOrEqual(300);
    });
  });

  describe('rejects with 403 integrity_failed (and creates nothing)', () => {
    it('a request without an integrity token (400, Google is not asked)', async () => {
      const { response, email } = await attemptRegister({}, { integrityToken: undefined });
      expect(response.status).toBe(400);
      expect(google.calls).toEqual([]);
      expect(await stack.prisma.user.count({ where: { email } })).toBe(0);
    });

    it.each([
      ['the wrong package name', { requestPackageName: 'com.evil.repack' }, 'wrong_package'],
      ['a token older than 2 minutes', { ageMs: MAX_TOKEN_AGE_MS + 5_000 }, 'stale_token'],
      [
        'an app Play does not recognise',
        { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' },
        'app_not_recognized',
      ],
      ['another signing certificate', { certDigestHex: 'cd'.repeat(32) }, 'wrong_certificate'],
      [
        'a device without device integrity',
        { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] },
        'device_not_integrity',
      ],
      [
        'a hash made for another request',
        { requestHash: computeRequestHash('login', 'x'.repeat(43), 'a@b.co') },
        'request_hash_mismatch',
      ],
    ])('%s', async (_name, changes, reason) => {
      const { response, email } = await attemptRegister(changes);

      expect(response.status).toBe(403);
      const error = errorOf(response);
      expect(error.code).toBe('integrity_failed');
      // The client learns nothing about WHICH check failed.
      expect(error.message).toBe('Device or app integrity check failed');
      expect(response.text).not.toContain(reason);
      expect(response.text).not.toContain('com.evil.repack');
      expect(await stack.prisma.user.count({ where: { email } })).toBe(0);

      // ...the operator does, in the audit log.
      const audit = stack
        .logText()
        .split('\n')
        .filter((line) => line.includes('"event":"integrity_failed"') && line.includes(reason));
      expect(audit.length).toBeGreaterThan(0);
    });

    it('a login token used to register (the action is part of the hash)', async () => {
      const ip = freshIp();
      const email = uniqueEmail('enforce');
      const nonce = await stack.client.nonce(ip);
      google.answer(payloadFor('login', nonce, email)); // made for login
      const response = await stack.client.post(
        '/api/auth/register',
        {
          displayName: 'Wrong Action',
          email,
          password: DEFAULT_PASSWORD,
          integrityToken: PLAY_TOKEN,
          integrityNonce: nonce,
        },
        { ip },
      );
      expect(response.status).toBe(403);
    });

    it('a token made for another email', async () => {
      const ip = freshIp();
      const nonce = await stack.client.nonce(ip);
      google.answer(payloadFor('register', nonce, uniqueEmail('someone-else')));
      const response = await stack.client.post(
        '/api/auth/register',
        {
          displayName: 'Wrong Email',
          email: uniqueEmail('enforce'),
          password: DEFAULT_PASSWORD,
          integrityToken: PLAY_TOKEN,
          integrityNonce: nonce,
        },
        { ip },
      );
      expect(response.status).toBe(403);
    });

    it('a token Google itself declares invalid', async () => {
      const ip = freshIp();
      const nonce = await stack.client.nonce(ip);
      google.handler = () => Promise.resolve({ kind: 'rejected' });
      const response = await stack.client.post(
        '/api/auth/register',
        {
          displayName: 'Bad Token',
          email: uniqueEmail('enforce'),
          password: DEFAULT_PASSWORD,
          integrityToken: PLAY_TOKEN,
          integrityNonce: nonce,
        },
        { ip },
      );
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe('integrity_failed');
    });
  });

  describe('nonces are single use', () => {
    it('a replayed nonce is rejected without asking Google again', async () => {
      const first = await attemptRegister();
      expect(first.response.status).toBe(201);
      expect(google.calls).toHaveLength(1);

      // The very same request again (same nonce, same token, even a fresh email).
      const replay = await stack.client.post(
        '/api/auth/register',
        {
          displayName: 'Replay',
          email: uniqueEmail('enforce'),
          password: DEFAULT_PASSWORD,
          integrityToken: PLAY_TOKEN,
          integrityNonce: first.nonce,
        },
        { ip: freshIp() },
      );
      expect(replay.status).toBe(403);
      expect(errorOf(replay).code).toBe('integrity_failed');
      expect(google.calls).toHaveLength(1); // Google was not called for the replay
    });

    it('a nonce that was never issued is rejected without asking Google', async () => {
      const { response } = await attemptRegister({}, { integrityNonce: 'Z'.repeat(43) });
      expect(response.status).toBe(403);
      expect(google.calls).toEqual([]);
    });

    it('an expired nonce (5 minutes) is rejected', async () => {
      const ip = freshIp();
      const email = uniqueEmail('enforce');
      const nonce = await stack.client.nonce(ip);
      await stack.redisClient.del(`integrity-nonce:${nonce}`); // what the TTL does after 5 minutes
      google.answer(payloadFor('register', nonce, email));
      const response = await stack.client.post(
        '/api/auth/register',
        {
          displayName: 'Expired',
          email,
          password: DEFAULT_PASSWORD,
          integrityToken: PLAY_TOKEN,
          integrityNonce: nonce,
        },
        { ip },
      );
      expect(response.status).toBe(403);
      expect(google.calls).toEqual([]);
    });

    it('is used up even when the verdict fails: the same nonce cannot be retried with a better token', async () => {
      const bad = await attemptRegister({ requestPackageName: 'com.evil.repack' });
      expect(bad.response.status).toBe(403);

      google.answer(payloadFor('register', bad.nonce, bad.email)); // now a perfect token
      const retry = await stack.client.post(
        '/api/auth/register',
        {
          displayName: 'Retry',
          email: bad.email,
          password: DEFAULT_PASSWORD,
          integrityToken: PLAY_TOKEN,
          integrityNonce: bad.nonce,
        },
        { ip: freshIp() },
      );
      expect(retry.status).toBe(403);
    });

    it('two requests racing with one nonce: only one reaches Google', async () => {
      const ip = freshIp();
      const nonce = await stack.client.nonce(ip);
      const emails = [uniqueEmail('race'), uniqueEmail('race')] as const;
      google.handler = (): Promise<DecodeResult> => {
        // Answer with a token that matches whichever email asked.
        return Promise.resolve({ kind: 'rejected' });
      };
      const responses = await Promise.all(
        emails.map((email) =>
          stack.client.post(
            '/api/auth/register',
            {
              displayName: 'Race',
              email,
              password: DEFAULT_PASSWORD,
              integrityToken: PLAY_TOKEN,
              integrityNonce: nonce,
            },
            { ip: freshIp() },
          ),
        ),
      );
      expect(responses.map((response) => response.status)).toEqual([403, 403]);
      expect(google.calls).toHaveLength(1);
    });
  });

  describe('when Google cannot be reached (fail closed)', () => {
    it('answers 503 integrity_unavailable with Retry-After, and creates nothing', async () => {
      const ip = freshIp();
      const email = uniqueEmail('enforce');
      const nonce = await stack.client.nonce(ip);
      google.handler = () => Promise.reject(AppException.integrityUnavailable());
      const body = {
        displayName: 'Offline',
        email,
        password: DEFAULT_PASSWORD,
        integrityToken: PLAY_TOKEN,
        integrityNonce: nonce,
      };

      const response = await stack.client.post('/api/auth/register', body, { ip });
      expect(response.status).toBe(503);
      expect(errorOf(response).code).toBe('integrity_unavailable');
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      expect(await stack.prisma.user.count({ where: { email } })).toBe(0);

      // The documented recovery: a NEW nonce and a new token.
      const retryNonce = await stack.client.nonce(freshIp());
      google.answer(payloadFor('register', retryNonce, email));
      const retry = await stack.client.post(
        '/api/auth/register',
        { ...body, integrityNonce: retryNonce },
        { ip: freshIp() },
      );
      expect(retry.status).toBe(201);
    });

    it('login fails closed too: no tokens without a verdict', async () => {
      const { email } = await attemptRegister();
      const ip = freshIp();
      const nonce = await stack.client.nonce(ip);
      google.handler = () => Promise.reject(AppException.integrityUnavailable());
      const response = await stack.client.post(
        '/api/auth/login',
        { email, password: DEFAULT_PASSWORD, integrityToken: PLAY_TOKEN, integrityNonce: nonce },
        { ip },
      );
      expect(response.status).toBe(503);
      expect(response.text).not.toContain('accessToken');
    });
  });

  describe('login', () => {
    it('is checked BEFORE the password: a bad verdict with the right password gets no tokens', async () => {
      const { email } = await attemptRegister();
      const response = await attemptLogin(email, DEFAULT_PASSWORD, {
        requestPackageName: 'com.evil.repack',
      });
      expect(response.status).toBe(403);
      expect(response.text).not.toContain('accessToken');
    });

    it('is no oracle: a bad verdict is 403 for an existing and for an unknown email alike', async () => {
      const { email } = await attemptRegister();
      const broken = { requestPackageName: 'com.evil.repack' };
      const known = await attemptLogin(email, DEFAULT_PASSWORD, broken);
      const unknown = await attemptLogin(uniqueEmail('ghost'), DEFAULT_PASSWORD, broken);
      expect(known.status).toBe(403);
      expect(unknown.status).toBe(403);
      expect(known.text.replace(/"requestId":"[^"]+"/, '')).toBe(
        unknown.text.replace(/"requestId":"[^"]+"/, ''),
      );
    });

    it('with a good verdict, a wrong password is still the ordinary 401', async () => {
      const { email } = await attemptRegister();
      const response = await attemptLogin(email, 'wrong-password-1');
      expect(response.status).toBe(401);
      expect(errorOf(response).code).toBe('invalid_credentials');
    });

    it('junk requests cannot lock an account: only requests that PASS the integrity check count against the per-email limit', async () => {
      const { email } = await attemptRegister();
      const emailKey = `rl:login:email:${sha256Hex(email)}`;

      // Someone who knows the address but has no attested device: more than the 10 allowed attempts.
      for (let attempt = 0; attempt < 12; attempt++) {
        const response = await attemptLogin(email, 'guess-password-1', {
          requestPackageName: 'com.evil.repack',
        });
        expect(response.status, `junk attempt ${attempt + 1}`).toBe(403);
      }
      expect(await stack.redisClient.exists(emailKey)).toBe(0);

      // The real owner signs in without trouble.
      expect((await attemptLogin(email, DEFAULT_PASSWORD)).status).toBe(200);

      // Requests that do pass the check DO count: ten wrong guesses lock the account for everyone.
      const target = (await attemptRegister()).email;
      for (let attempt = 1; attempt <= 10; attempt++) {
        expect((await attemptLogin(target, 'wrong-password-1')).status).toBe(401);
      }
      const locked = await attemptLogin(target, DEFAULT_PASSWORD);
      expect(locked.status).toBe(429);
      expect(errorOf(locked).code).toBe('rate_limited');
    });
  });

  it('the integrity token and nonces are never logged and never echoed', async () => {
    await attemptRegister();
    await attemptRegister({ requestPackageName: 'com.evil.repack' });
    expect(stack.logText()).not.toContain(PLAY_TOKEN);
    const { response, nonce } = await attemptRegister({ ageMs: 10 * 60_000 });
    expect(response.text).not.toContain(PLAY_TOKEN);
    expect(stack.logText()).not.toContain(nonce);
  });
});
