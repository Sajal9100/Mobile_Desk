import { createPrivateKey, randomUUID, type KeyObject } from 'node:crypto';
import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '../../src/common/config/config.service.js';
import { parseConfig } from '../../src/common/config/load-config.js';
import { AppException } from '../../src/common/errors/app.exception.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenService,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../../src/modules/auth/access-token.service.js';
import { generateEd25519, validEnv, type Ed25519Pair } from '../helpers/test-config.js';

const USER = randomUUID();
const DEVICE = randomUUID();

type Fixture = { service: AccessTokenService; pair: Ed25519Pair; kid: string };

function createService(keys: Record<string, Ed25519Pair>, activeKid: string): AccessTokenService {
  const privateKeys = Object.fromEntries(
    Object.entries(keys).map(([kid, pair]) => [kid, pair.privatePem]),
  );
  const parsed = parseConfig(
    validEnv({ JWT_PRIVATE_KEYS: JSON.stringify(privateKeys), JWT_ACTIVE_KID: activeKid }),
  );
  if (!parsed.ok) throw new Error('test configuration is invalid');
  const service = new AccessTokenService(new ConfigService(parsed.config));
  service.onModuleInit();
  return service;
}

function createPrivate(pair: Ed25519Pair): KeyObject {
  return createPrivateKey(pair.privatePem);
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** What verify() throws for a bad token. Fails the test if it accepts the token. */
async function rejectionOf(service: AccessTokenService, token: string): Promise<AppException> {
  const error = await service.verify(token).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

async function expectRejected(service: AccessTokenService, token: string): Promise<void> {
  expect(await rejectionOf(service, token)).toMatchObject({ code: 'unauthorized', status: 401 });
}

describe('AccessTokenService', () => {
  let fixture: Fixture;
  let attacker: Ed25519Pair;

  beforeAll(() => {
    const pair = generateEd25519();
    fixture = { service: createService({ k1: pair }, 'k1'), pair, kid: 'k1' };
    attacker = generateEd25519();
  });

  /** A well-formed token that is valid except for whatever the test changes. */
  function craft(
    options: {
      alg?: string;
      kid?: string | null;
      key?: Parameters<SignJWT['sign']>[0];
      issuer?: string;
      audience?: string;
      subject?: string;
      did?: string | null;
      issuedAt?: number;
      expiresAt?: number;
      jti?: string | null;
    } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT({ did: options.did === undefined ? null : options.did })
      .setProtectedHeader({
        alg: options.alg ?? 'EdDSA',
        ...(options.kid === null ? {} : { kid: options.kid ?? fixture.kid }),
      })
      .setSubject(options.subject ?? USER)
      .setIssuer(options.issuer ?? JWT_ISSUER)
      .setAudience(options.audience ?? JWT_AUDIENCE)
      .setIssuedAt(options.issuedAt ?? now)
      .setExpirationTime(options.expiresAt ?? now + 600);
    if (options.jti !== null) jwt.setJti(options.jti ?? randomUUID());
    return jwt.sign(options.key ?? createPrivate(fixture.pair));
  }

  describe('a valid token', () => {
    it('signs and verifies: user id and device id come back', async () => {
      const token = await fixture.service.sign(USER, DEVICE);
      await expect(fixture.service.verify(token)).resolves.toEqual({
        userId: USER,
        deviceId: DEVICE,
      });
    });

    it('carries a null device id before the device is registered', async () => {
      const token = await fixture.service.sign(USER, null);
      await expect(fixture.service.verify(token)).resolves.toEqual({
        userId: USER,
        deviceId: null,
      });
    });

    it('has the claims and header the brief asks for', async () => {
      const token = await fixture.service.sign(USER, DEVICE);
      expect(decodeProtectedHeader(token)).toEqual({ alg: 'EdDSA', kid: 'k1' });
      const claims = decodeJwt(token);
      expect(claims).toMatchObject({ sub: USER, did: DEVICE, iss: JWT_ISSUER, aud: JWT_AUDIENCE });
      expect(typeof claims.jti).toBe('string');
      expect(claims.exp).toBe((claims.iat ?? 0) + ACCESS_TOKEN_TTL_SECONDS);
      expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    });

    it('every token has its own jti', async () => {
      const [a, b] = await Promise.all([
        fixture.service.sign(USER, null),
        fixture.service.sign(USER, null),
      ]);
      expect(decodeJwt(a).jti).not.toBe(decodeJwt(b).jti);
    });

    it('accepts a token that expired 20 s ago (30 s clock tolerance)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await craft({ issuedAt: now - 900, expiresAt: now - 20 });
      await expect(fixture.service.verify(token)).resolves.toMatchObject({ userId: USER });
    });
  });

  describe('is rejected with 401 unauthorized', () => {
    it('alg "none" (an unsigned token)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${base64url({ alg: 'none', kid: 'k1' })}.${base64url({
        sub: USER,
        did: null,
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
        iat: now,
        exp: now + 600,
        jti: randomUUID(),
      })}.`;
      await expectRejected(fixture.service, unsigned);
    });

    it('alg HS256 signed with the PUBLIC key as the secret (key confusion)', async () => {
      const token = await craft({
        alg: 'HS256',
        key: new TextEncoder().encode(fixture.pair.publicPem),
      });
      await expectRejected(fixture.service, token);
    });

    it('a token signed by someone else under our key id', async () => {
      await expectRejected(fixture.service, await craft({ key: createPrivate(attacker) }));
    });

    it('a tampered payload', async () => {
      const token = await fixture.service.sign(USER, null);
      const [header, payload, signature] = token.split('.');
      const forged = base64url({ ...(decodeJwt(token) as object), sub: randomUUID() });
      expect(forged).not.toBe(payload);
      await expectRejected(fixture.service, `${header}.${forged}.${signature}`);
    });

    it('the wrong audience', async () => {
      await expectRejected(fixture.service, await craft({ audience: 'someone-else' }));
    });

    it('the wrong issuer', async () => {
      await expectRejected(fixture.service, await craft({ issuer: 'https://evil.example' }));
    });

    it('an expired token (beyond the clock tolerance)', async () => {
      const now = Math.floor(Date.now() / 1000);
      await expectRejected(
        fixture.service,
        await craft({ issuedAt: now - 1000, expiresAt: now - 60 }),
      );
    });

    it('an unknown key id', async () => {
      await expectRejected(fixture.service, await craft({ kid: 'unknown-key' }));
    });

    it('no key id at all', async () => {
      await expectRejected(fixture.service, await craft({ kid: null }));
    });

    it('a missing jti', async () => {
      await expectRejected(fixture.service, await craft({ jti: null }));
    });

    it('a subject that is not a UUID', async () => {
      await expectRejected(fixture.service, await craft({ subject: 'admin' }));
    });

    it('a device claim that is not a UUID', async () => {
      await expectRejected(fixture.service, await craft({ did: 'not-a-uuid' }));
    });

    it.each([
      ['empty', ''],
      ['garbage', 'garbage'],
      ['two segments', 'a.b'],
      ['three junk segments', 'a.b.c'],
      ['oversized (3000 characters)', 'x'.repeat(3000)],
    ])('a malformed token: %s', async (_name, token) => {
      await expectRejected(fixture.service, token);
    });

    it('the response never says which check failed', async () => {
      const failures = await Promise.all(
        [await craft({ audience: 'x' }), await craft({ kid: 'nope' }), 'garbage'].map((token) =>
          rejectionOf(fixture.service, token),
        ),
      );
      expect(new Set(failures.map((failure) => failure.message)).size).toBe(1);
    });
  });

  describe('key rotation', () => {
    it('signs with the active key and still accepts tokens of the previous key', async () => {
      const oldPair = generateEd25519();
      const newPair = generateEd25519();
      const before = createService({ old: oldPair }, 'old');
      const oldToken = await before.sign(USER, null);

      // After rotation both keys are listed and the new one is active.
      const after = createService({ old: oldPair, fresh: newPair }, 'fresh');
      const newToken = await after.sign(USER, null);

      expect(decodeProtectedHeader(newToken).kid).toBe('fresh');
      await expect(after.verify(oldToken)).resolves.toMatchObject({ userId: USER });
      await expect(after.verify(newToken)).resolves.toMatchObject({ userId: USER });
    });

    it('once the old key is removed, its tokens stop working', async () => {
      const oldPair = generateEd25519();
      const newPair = generateEd25519();
      const oldToken = await createService({ old: oldPair }, 'old').sign(USER, null);
      const rotated = createService({ fresh: newPair }, 'fresh');
      await expectRejected(rotated, oldToken);
    });
  });
});
