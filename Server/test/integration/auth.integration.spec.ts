import { createPrivateKey, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../src/common/crypto.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../../src/modules/auth/access-token.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { generateEd25519 } from '../helpers/test-config.js';
import {
  DEFAULT_PASSWORD,
  freshIp,
  uniqueEmail,
  type AuthPayload,
  type ErrorPayload,
} from './helpers/client.js';
import { startStack, stopStack, type Stack } from './helpers/stack.js';

// Needs Docker. Runs the real application against Postgres 16 and Redis 7 in `bypass` mode (the
// Google side is covered by integrity.integration.spec.ts).

describe('register, login and /api/me', () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  describe('registration', () => {
    it('creates the account and answers with the user and a token pair', async () => {
      const { response, email } = await stack.client.register({ displayName: '  Alice  ' });

      expect(response.status).toBe(201);
      const body = response.json<AuthPayload>();
      expect(Object.keys(body).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
      expect(Object.keys(body.user).sort()).toEqual(['createdAt', 'displayName', 'email', 'id']);
      expect(body.user).toMatchObject({ email, displayName: 'Alice' });
      expect(new Date(body.user.createdAt).toISOString()).toBe(body.user.createdAt);
      expect(body.accessToken.split('.')).toHaveLength(3);
      expect(body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.text).not.toMatch(/passwordHash|password_hash|argon2/i);
    });

    it('stores an Argon2id hash, default settings and only the SHA-256 of the refresh token', async () => {
      const { response, email, password } = await stack.client.register();
      const body = response.json<AuthPayload>();

      const user = await stack.prisma.user.findUniqueOrThrow({
        where: { email },
        include: { settings: true, refreshTokens: true },
      });
      expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(user.passwordHash).not.toContain(password);
      expect(user.status).toBe('active');
      expect(user.deletedAt).toBeNull();
      expect(user.settings).toEqual({
        userId: user.id,
        onlyMyDevices: false,
        requirePin: false,
        relayOnlyDefault: true,
      });

      expect(user.refreshTokens).toHaveLength(1);
      const [token] = user.refreshTokens;
      expect(token?.tokenHash).toBe(sha256Hex(body.refreshToken));
      expect(token).toMatchObject({ deviceId: null, usedAt: null, revokedAt: null });
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs((token?.expiresAt.getTime() ?? 0) - (Date.now() + thirtyDays))).toBeLessThan(
        60_000,
      );
      // The raw token is nowhere in the table.
      const dump = JSON.stringify(
        await stack.prisma.$queryRaw`SELECT * FROM refresh_tokens WHERE user_id = ${user.id}::uuid`,
      );
      expect(dump).not.toContain(body.refreshToken);
    });

    it('stores the email trimmed and lower-cased, and refuses it a second time in any spelling', async () => {
      const local = `Mixed-${randomUUID().slice(0, 8)}`;
      const first = await stack.client.register({ email: `  ${local}@Example.COM ` });
      expect(first.response.status).toBe(201);
      expect(first.response.json<AuthPayload>().user.email).toBe(
        `${local.toLowerCase()}@example.com`,
      );

      for (const spelling of [
        `${local.toLowerCase()}@example.com`,
        `${local.toUpperCase()}@EXAMPLE.COM`,
      ]) {
        const again = await stack.client.register({ email: spelling });
        expect(again.response.status).toBe(409);
        expect(again.response.json<ErrorPayload>().error.code).toBe('email_taken');
      }
    });

    it.each([
      ['a weak password', { password: 'short1' }],
      ['a password without a digit', { password: 'abcdefghijkl' }],
      ['an invalid email', { email: 'not-an-email' }],
      ['a one-letter name', { displayName: 'A' }],
      ['an unknown field', { isAdmin: true }],
      ['a malformed nonce', { integrityNonce: 'short' }],
    ])('rejects %s with 400 validation_failed and echoes nothing', async (_name, overrides) => {
      const { response } = await stack.client.register(overrides);
      expect(response.status).toBe(400);
      const text = response.text;
      expect(response.json<ErrorPayload>().error.code).toBe('validation_failed');
      for (const value of Object.values(overrides)) expect(text).not.toContain(String(value));
    });

    it('requires a valid single-use nonce even in bypass mode (403 integrity_failed)', async () => {
      const ip = freshIp();
      const never = await stack.client.post(
        '/api/auth/register',
        {
          displayName: 'No Nonce',
          email: uniqueEmail(),
          password: DEFAULT_PASSWORD,
          integrityToken: 'bypass-token',
          integrityNonce: 'A'.repeat(43), // well-formed but never issued
        },
        { ip },
      );
      expect(never.status).toBe(403);
      expect(never.json<ErrorPayload>().error.code).toBe('integrity_failed');

      const nonce = await stack.client.nonce(ip);
      const body = (email: string) => ({
        displayName: 'Replay',
        email,
        password: DEFAULT_PASSWORD,
        integrityToken: 'bypass-token',
        integrityNonce: nonce,
      });
      expect(
        (await stack.client.post('/api/auth/register', body(uniqueEmail()), { ip })).status,
      ).toBe(201);
      const replay = await stack.client.post('/api/auth/register', body(uniqueEmail()), { ip });
      expect(replay.status).toBe(403);
    });

    it('does not create anything when it fails', async () => {
      const email = uniqueEmail();
      await stack.client.register({ email, password: 'weak' });
      await stack.client.register({ email, integrityNonce: 'A'.repeat(43) });
      expect(await stack.prisma.user.count({ where: { email } })).toBe(0);
    });
  });

  describe('login and /api/me', () => {
    it('register -> login -> /api/me works end to end', async () => {
      const { response, email, password } = await stack.client.register({ displayName: 'Bob' });
      const registered = response.json<AuthPayload>();

      const login = await stack.client.login(email, password);
      expect(login.status).toBe(200);
      const body = login.json<AuthPayload>();
      expect(body.user).toEqual(registered.user);
      expect(body.refreshToken).not.toBe(registered.refreshToken); // a new family per login
      expect(login.headers['cache-control']).toBe('no-store');

      const me = await stack.client.get('/api/me', { token: body.accessToken });
      expect(me.status).toBe(200);
      expect(me.json()).toEqual({ user: registered.user });
      expect(me.text).not.toMatch(/passwordHash|password_hash|argon2|status|deletedAt/i);

      // The registration token works too.
      expect((await stack.client.get('/api/me', { token: registered.accessToken })).status).toBe(
        200,
      );
    });

    it('login matches the email whatever its case or spacing', async () => {
      const { email, password } = await stack.client.register();
      const response = await stack.client.login(`  ${email.toUpperCase()}  `, password);
      expect(response.status).toBe(200);
    });

    it('a wrong password and an unknown email give the identical answer', async () => {
      const { email, password } = await stack.client.register();

      const wrongPassword = await stack.client.login(email, `${password}-wrong`);
      const unknownEmail = await stack.client.login(uniqueEmail('ghost'), password);

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      const strip = (text: string) => {
        const parsed = JSON.parse(text) as ErrorPayload;
        return { code: parsed.error.code, message: parsed.error.message };
      };
      expect(strip(wrongPassword.text)).toEqual(strip(unknownEmail.text));
      expect(strip(wrongPassword.text).code).toBe('invalid_credentials');
      expect(wrongPassword.headers['content-length']).toBe(unknownEmail.headers['content-length']);
      expect(unknownEmail.text).not.toContain('ghost');
    });

    it('spends a real password check on an unknown email (no timing difference to exploit)', async () => {
      const passwords = stack.app.get(PasswordService);
      const dummy = vi.spyOn(passwords, 'verifyAgainstDummy');
      const verify = vi.spyOn(passwords, 'verify');
      try {
        const known = await stack.client.register();
        dummy.mockClear();
        verify.mockClear();

        await stack.client.login(known.email, 'wrong-password-1');
        expect(verify).toHaveBeenCalledTimes(1);
        expect(dummy).not.toHaveBeenCalled();

        dummy.mockClear();
        verify.mockClear();
        await stack.client.login(uniqueEmail('ghost'), 'wrong-password-1');
        expect(dummy).toHaveBeenCalledTimes(1); // the dummy hash went through verify()
        expect(verify).toHaveBeenCalledTimes(1);
      } finally {
        dummy.mockRestore();
        verify.mockRestore();
      }
    });

    it('takes about as long for an unknown email as for a wrong password', async () => {
      const { email } = await stack.client.register();
      const time = async (run: () => Promise<unknown>) => {
        const started = performance.now();
        await run();
        return performance.now() - started;
      };
      const samples = 5;
      let wrong = 0;
      let unknown = 0;
      for (let i = 0; i < samples; i++) {
        wrong += await time(() => stack.client.login(email, 'wrong-password-1'));
        unknown += await time(() => stack.client.login(uniqueEmail('ghost'), 'wrong-password-1'));
      }
      // Both include one Argon2 verification (tens of ms). A missing dummy hash would make the
      // unknown-email path several times faster; a loose factor keeps this stable on busy CI.
      expect(unknown / wrong).toBeGreaterThan(0.5);
    });

    it('re-hashes a password stored with weaker parameters on a successful login', async () => {
      const { email, password } = await stack.client.register();
      const weak = await import('argon2').then((argon2) =>
        argon2.default.hash(password, {
          type: argon2.default.argon2id,
          memoryCost: 8_192,
          timeCost: 1,
          parallelism: 1,
        }),
      );
      await stack.prisma.user.update({ where: { email }, data: { passwordHash: weak } });

      expect((await stack.client.login(email, password)).status).toBe(200);

      const { passwordHash } = await stack.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(passwordHash).toMatch(/\$m=19456,t=2,p=1\$/);
      expect((await stack.client.login(email, password)).status).toBe(200); // still works
    });
  });

  describe('a suspended account', () => {
    it('cannot sign in even with the right password, and does not learn more with a wrong one', async () => {
      const { email, password } = await stack.client.register();
      await stack.prisma.user.update({ where: { email }, data: { status: 'suspended' } });

      const right = await stack.client.login(email, password);
      expect(right.status).toBe(403);
      expect(right.json<ErrorPayload>().error.code).toBe('forbidden');

      const wrong = await stack.client.login(email, `${password}-wrong`);
      expect(wrong.status).toBe(401);
      expect(wrong.json<ErrorPayload>().error.code).toBe('invalid_credentials');
    });

    it('its still-valid access token stops working within 60 seconds', async () => {
      const user = await stack.client.signUp();
      expect((await stack.client.get('/api/me', { token: user.accessToken })).status).toBe(200);

      await stack.prisma.user.update({
        where: { id: user.user.id },
        data: { status: 'suspended' },
      });

      // The answer "active" is cached, and the cache can never hold it for longer than 60 s.
      const key = `user-status:${user.user.id}`;
      const ttl = await stack.redisClient.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);

      // Let the cached entry run out (1 s here instead of up to 60 s): the next request asks the
      // database and the token is refused.
      await stack.redisClient.expire(key, 1);
      await delay(1_300);
      const after = await stack.client.get('/api/me', { token: user.accessToken });
      expect(after.status).toBe(401);
      expect(after.json<ErrorPayload>().error.code).toBe('unauthorized');
    });

    it('its refresh token stops working at once', async () => {
      const user = await stack.client.signUp();
      await stack.prisma.user.update({
        where: { id: user.user.id },
        data: { status: 'suspended' },
      });
      const response = await stack.client.refresh(user.refreshToken);
      expect(response.status).toBe(401);
      expect(response.json<ErrorPayload>().error.code).toBe('invalid_refresh_token');
    });
  });

  describe('protected routes reject every kind of bad token', () => {
    const routes = [
      ['GET', '/api/me', undefined],
      ['DELETE', '/api/account', { password: 'whatever-1' }],
    ] as const;

    async function craft(options: {
      audience?: string;
      issuer?: string;
      privateKeyPem?: string;
      expiresInSeconds?: number;
      subject?: string;
      kid?: string;
    }): Promise<string> {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ did: null })
        .setProtectedHeader({ alg: 'EdDSA', kid: options.kid ?? stack.kid })
        .setSubject(options.subject ?? randomUUID())
        .setIssuer(options.issuer ?? JWT_ISSUER)
        .setAudience(options.audience ?? JWT_AUDIENCE)
        .setIssuedAt(now - 1_000)
        .setExpirationTime(now + (options.expiresInSeconds ?? 600))
        .setJti(randomUUID())
        .sign(createPrivateKey(options.privateKeyPem ?? stack.jwtKeys.privatePem));
    }

    it.each(routes)('%s %s without credentials -> 401 unauthorized', async (method, url, body) => {
      const response = await stack.client.request(method, url, body === undefined ? {} : { body });
      expect(response.status).toBe(401);
      expect(response.json<ErrorPayload>().error.code).toBe('unauthorized');
    });

    it.each(routes)('%s %s rejects bad tokens', async (method, url, body) => {
      const user = await stack.client.signUp();
      const cases: [string, string][] = [
        ['garbage', 'garbage'],
        ['wrong scheme', `Basic ${user.accessToken}`],
        ['token only, no scheme', user.accessToken],
        [
          'signed by another key',
          await craft({ privateKeyPem: generateEd25519().privatePem, subject: user.user.id }),
        ],
        ['wrong audience', await craft({ audience: 'other-app', subject: user.user.id })],
        ['wrong issuer', await craft({ issuer: 'https://evil.example', subject: user.user.id })],
        ['expired', await craft({ expiresInSeconds: -120, subject: user.user.id })],
        ['unknown key id', await craft({ kid: 'nope', subject: user.user.id })],
        ['valid signature, user that does not exist', await craft({})],
      ];
      for (const [name, credential] of cases) {
        const header =
          name.startsWith('wrong scheme') || name.startsWith('token only')
            ? credential
            : `Bearer ${credential}`;
        const response = await stack.client.request(method, url, {
          headers: { authorization: header },
          ...(body === undefined ? {} : { body }),
        });
        expect(response.status, `${method} ${url}: ${name}`).toBe(401);
        expect(response.json<ErrorPayload>().error.code, name).toBe('unauthorized');
      }
    });

    it('an unknown route is still a plain 404 (not 401)', async () => {
      const response = await stack.client.get('/api/does-not-exist');
      expect(response.status).toBe(404);
      expect(response.json<ErrorPayload>().error.code).toBe('not_found');
    });
  });
});
