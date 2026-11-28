import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_TOKEN_AGE_MS,
  computeRequestHash,
  evaluateVerdict,
  tokenPayloadSchema,
  type TokenPayload,
  type VerdictInput,
} from '../../src/modules/integrity/verdict.js';

const NOW = 1_800_000_000_000;
const PACKAGE = 'app.mobiledesk.test';
const CERT_HEX = 'ab'.repeat(32);
const CERT_B64URL = Buffer.from(CERT_HEX, 'hex').toString('base64url');
const NONCE = 'A'.repeat(43);
const EMAIL = 'user@example.com';

describe('computeRequestHash (the app computes the same value)', () => {
  it('matches the test vectors published in contracts/openapi.yaml', () => {
    expect(computeRequestHash('register', NONCE, EMAIL)).toBe(
      '1ftE21j4RseCyTklF7PYAQ5mscwuu7E2CQDkplO1OtU',
    );
    expect(computeRequestHash('login', NONCE, EMAIL)).toBe(
      'TdlQZYcwjiwPS3UE_HdcbtzOrdL32pKvh3x4kF3ppSM',
    );
  });

  it('is base64url(SHA-256("<action>|<nonce>|<email>"))', () => {
    const expected = createHash('sha256').update(`login|${NONCE}|${EMAIL}`).digest('base64url');
    expect(computeRequestHash('login', NONCE, EMAIL)).toBe(expected);
    expect(expected).toHaveLength(43);
  });

  it('a register token cannot be used to log in, and another nonce or email changes the hash', () => {
    const base = computeRequestHash('register', NONCE, EMAIL);
    expect(computeRequestHash('login', NONCE, EMAIL)).not.toBe(base);
    expect(computeRequestHash('register', 'B'.repeat(43), EMAIL)).not.toBe(base);
    expect(computeRequestHash('register', NONCE, 'other@example.com')).not.toBe(base);
  });
});

function payload(
  overrides: Partial<{
    requestPackageName: string;
    requestHash: string | undefined;
    timestampMillis: string | number;
    appRecognitionVerdict: string | undefined;
    certificateSha256Digest: string[] | undefined;
    deviceRecognitionVerdict: string[] | undefined;
    omitApp: boolean;
    omitDevice: boolean;
  }> = {},
): TokenPayload {
  const has = (key: keyof typeof overrides) => key in overrides;
  return {
    requestDetails: {
      requestPackageName: overrides.requestPackageName ?? PACKAGE,
      ...(has('requestHash') && overrides.requestHash === undefined
        ? {}
        : { requestHash: overrides.requestHash ?? computeRequestHash('login', NONCE, EMAIL) }),
      timestampMillis: overrides.timestampMillis ?? String(NOW - 5_000),
    },
    ...(overrides.omitApp === true
      ? {}
      : {
          appIntegrity: {
            appRecognitionVerdict: has('appRecognitionVerdict')
              ? overrides.appRecognitionVerdict
              : 'PLAY_RECOGNIZED',
            certificateSha256Digest: has('certificateSha256Digest')
              ? overrides.certificateSha256Digest
              : [CERT_B64URL],
          },
        }),
    ...(overrides.omitDevice === true
      ? {}
      : {
          deviceIntegrity: {
            deviceRecognitionVerdict: has('deviceRecognitionVerdict')
              ? overrides.deviceRecognitionVerdict
              : ['MEETS_BASIC_INTEGRITY', 'MEETS_DEVICE_INTEGRITY'],
          },
        }),
  };
}

function evaluate(token: TokenPayload, overrides: Partial<VerdictInput> = {}) {
  return evaluateVerdict({
    payload: token,
    expectedPackageName: PACKAGE,
    trustedCertDigests: [CERT_HEX],
    expectedRequestHash: computeRequestHash('login', NONCE, EMAIL),
    nowMs: NOW,
    ...overrides,
  });
}

describe('evaluateVerdict', () => {
  it('accepts a token that passes every check', () => {
    expect(evaluate(payload())).toEqual({ ok: true, reasons: [] });
  });

  it("accepts a numeric timestamp as well as Google's string", () => {
    expect(evaluate(payload({ timestampMillis: NOW - 1_000 })).ok).toBe(true);
  });

  it.each([
    ['another package', payload({ requestPackageName: 'com.evil.app' }), 'wrong_package'],
    [
      'a request hash for another action',
      payload({ requestHash: computeRequestHash('register', NONCE, EMAIL) }),
      'request_hash_mismatch',
    ],
    [
      'a request hash for another email',
      payload({ requestHash: computeRequestHash('login', NONCE, 'other@example.com') }),
      'request_hash_mismatch',
    ],
    ['no request hash', payload({ requestHash: undefined }), 'request_hash_mismatch'],
    [
      'a token older than 2 minutes',
      payload({ timestampMillis: String(NOW - MAX_TOKEN_AGE_MS - 1) }),
      'stale_token',
    ],
    [
      'a token from the future',
      payload({ timestampMillis: String(NOW + MAX_TOKEN_AGE_MS + 1) }),
      'stale_token',
    ],
    ['a timestamp that is not a number', payload({ timestampMillis: 'soon' }), 'stale_token'],
    [
      'an unrecognised app version',
      payload({ appRecognitionVerdict: 'UNRECOGNIZED_VERSION' }),
      'app_not_recognized',
    ],
    ['an unevaluated app', payload({ appRecognitionVerdict: 'UNEVALUATED' }), 'app_not_recognized'],
    ['no app verdict at all', payload({ omitApp: true }), 'app_not_recognized'],
    [
      'another signing certificate',
      payload({ certificateSha256Digest: [Buffer.alloc(32, 7).toString('base64url')] }),
      'wrong_certificate',
    ],
    ['no certificate digest', payload({ certificateSha256Digest: [] }), 'wrong_certificate'],
    [
      'a device that only meets basic integrity',
      payload({ deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] }),
      'device_not_integrity',
    ],
    ['an empty device verdict', payload({ deviceRecognitionVerdict: [] }), 'device_not_integrity'],
    ['no device verdict at all', payload({ omitDevice: true }), 'device_not_integrity'],
  ])('rejects %s', (_name, token, reason) => {
    const verdict = evaluate(token);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toContain(reason);
  });

  it('accepts the boundary of the 2 minute window and rejects one millisecond beyond', () => {
    expect(evaluate(payload({ timestampMillis: String(NOW - MAX_TOKEN_AGE_MS) })).ok).toBe(true);
    expect(evaluate(payload({ timestampMillis: String(NOW - MAX_TOKEN_AGE_MS - 1) })).ok).toBe(
      false,
    );
  });

  it('reports every failing check, not just the first', () => {
    const verdict = evaluate(
      payload({
        requestPackageName: 'com.evil.app',
        appRecognitionVerdict: 'UNEVALUATED',
        deviceRecognitionVerdict: [],
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual(
      expect.arrayContaining(['wrong_package', 'app_not_recognized', 'device_not_integrity']),
    );
  });

  it('accepts the certificate when ANY configured digest matches (certificate rotation)', () => {
    const other = 'cd'.repeat(32);
    expect(evaluate(payload(), { trustedCertDigests: [other, CERT_HEX] }).ok).toBe(true);
    expect(evaluate(payload(), { trustedCertDigests: [other] }).reasons).toContain(
      'wrong_certificate',
    );
  });

  it('reasons are fixed codes: they never contain a value from the token', () => {
    const verdict = evaluate(payload({ requestPackageName: 'SECRET_PACKAGE_SENTINEL' }));
    expect(JSON.stringify(verdict)).not.toContain('SECRET_PACKAGE_SENTINEL');
  });
});

describe('tokenPayloadSchema', () => {
  it("reads Google's real field names and drops unknown fields", () => {
    const parsed = tokenPayloadSchema.parse({
      requestDetails: {
        requestPackageName: PACKAGE,
        requestHash: 'abc',
        timestampMillis: '1800000000000',
        somethingNew: true,
      },
      appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', versionCode: '12' },
      deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
      accountDetails: { appLicensingVerdict: 'LICENSED' },
    });
    expect(parsed.requestDetails).not.toHaveProperty('somethingNew');
    expect(parsed).not.toHaveProperty('accountDetails');
  });

  it('tolerates the parts Google omits when it could not evaluate them', () => {
    const parsed = tokenPayloadSchema.safeParse({
      requestDetails: { requestPackageName: PACKAGE, timestampMillis: '1' },
      appIntegrity: { appRecognitionVerdict: 'UNEVALUATED' },
      deviceIntegrity: {},
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a payload without request details', () => {
    expect(tokenPayloadSchema.safeParse({ appIntegrity: {} }).success).toBe(false);
  });
});
