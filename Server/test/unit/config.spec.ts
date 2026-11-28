import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfigOrExit, parseConfig } from '../../src/common/config/load-config.js';
import {
  TEST_CERT_SHA256,
  TEST_KID,
  enforceEnv,
  generateEd25519,
  googleServiceAccountJson,
  jwtEnv,
  validEnv,
} from '../helpers/test-config.js';

const valid = validEnv();

function without(key: string): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...valid };
  delete copy[key];
  return copy;
}

function problemFor(env: NodeJS.ProcessEnv, variable: string): string | undefined {
  const result = parseConfig(env);
  if (result.ok) return undefined;
  return result.issues.find((issue) => issue.variable === variable)?.problem;
}

describe('config schema', () => {
  it('accepts a valid environment and applies safe defaults', () => {
    const result = parseConfig(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.PORT_API).toBe(3000);
    expect(result.config.BIND_HOST).toBe('127.0.0.1');
    expect(result.config.LOG_LEVEL).toBe('info');
    expect(result.config.CORS_ORIGINS).toEqual([]);
    expect(result.config.TRUST_PROXY).toBe(false);
    expect(result.config.JWT_ACTIVE_KID).toBe(TEST_KID);
  });

  it.each([
    'NODE_ENV',
    'PORT_API',
    'PORT_REALTIME',
    'DATABASE_URL',
    'REDIS_URL',
    'APP_PUBLIC_BASE_URL',
    'JWT_PRIVATE_KEYS',
    'JWT_ACTIVE_KID',
  ])('rejects a missing %s and says "missing"', (variable) => {
    const result = parseConfig(without(variable));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({ variable, problem: 'missing' });
  });

  it('treats an empty value like an unset one (Docker Compose passes unset variables as "")', () => {
    expect(problemFor({ ...valid, DATABASE_URL: '' }, 'DATABASE_URL')).toBe('missing');
  });

  it.each([
    ['PORT_API', '0'],
    ['PORT_API', '70000'],
    ['PORT_API', 'abc'],
    ['PORT_REALTIME', '3000.5'],
    ['DATABASE_URL', 'mysql://u:p@h/db'],
    ['DATABASE_URL', 'not a url'],
    ['REDIS_URL', 'http://localhost:6379'],
    ['LOG_LEVEL', 'loud'],
    ['NODE_ENV', 'staging'],
    ['APP_PUBLIC_BASE_URL', 'ftp://example.com'],
  ])('rejects %s=%s', (variable, value) => {
    const result = parseConfig({ ...valid, [variable]: value });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.variable)).toContain(variable);
  });

  it('requires https for APP_PUBLIC_BASE_URL in production only', () => {
    const production = { ...valid, NODE_ENV: 'production', ...enforceEnv() };
    expect(parseConfig(production).ok).toBe(false);
    expect(parseConfig({ ...production, APP_PUBLIC_BASE_URL: 'https://api.example.app' }).ok).toBe(
      true,
    );
  });

  it('parses CORS_ORIGINS and rejects wildcards and non-origins', () => {
    const ok = parseConfig({ ...valid, CORS_ORIGINS: 'https://a.example, https://b.example' });
    expect(ok.ok && ok.config.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
    expect(parseConfig({ ...valid, CORS_ORIGINS: '*' }).ok).toBe(false);
    expect(parseConfig({ ...valid, CORS_ORIGINS: 'not-an-origin' }).ok).toBe(false);
  });
});

describe('JWT signing keys', () => {
  it('accepts several keys and an active kid that is one of them', () => {
    const second = generateEd25519();
    const first = jwtEnv('k1');
    const keys = JSON.stringify({
      ...(JSON.parse(first.env['JWT_PRIVATE_KEYS'] ?? '{}') as Record<string, string>),
      k2: second.privatePem,
    });
    const result = parseConfig({ ...valid, JWT_PRIVATE_KEYS: keys, JWT_ACTIVE_KID: 'k2' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.config.JWT_PRIVATE_KEYS).sort()).toEqual(['k1', 'k2']);
  });

  it('rejects an active kid that is not in JWT_PRIVATE_KEYS', () => {
    expect(problemFor({ ...valid, JWT_ACTIVE_KID: 'someone-else' }, 'JWT_ACTIVE_KID')).toBe(
      'must be one of the key ids in JWT_PRIVATE_KEYS',
    );
  });

  it.each([
    ['not json', 'not-json'],
    ['a JSON array', '[]'],
    ['an empty object', '{}'],
    ['a non-string key', '{"k1":42}'],
    ['a bad PEM', '{"k1":"-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----"}'],
    ['a bad kid', JSON.stringify({ 'has space': generateEd25519().privatePem })],
  ])('rejects JWT_PRIVATE_KEYS that is %s', (_name, value) => {
    expect(parseConfig({ ...valid, JWT_PRIVATE_KEYS: value, JWT_ACTIVE_KID: 'k1' }).ok).toBe(false);
  });

  it('rejects a key that is not Ed25519 (an RSA key would silently change the algorithm)', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const env = { ...valid, JWT_PRIVATE_KEYS: JSON.stringify({ k1: rsa }), JWT_ACTIVE_KID: 'k1' };
    expect(problemFor(env, 'JWT_PRIVATE_KEYS')).toBe('every key must be an Ed25519 private key');
  });
});

describe('Play Integrity configuration', () => {
  it('defaults to enforce, which needs the package, the certificate and the Google account', () => {
    const base = without('INTEGRITY_MODE');
    for (const variable of [
      'INTEGRITY_PACKAGE_NAME',
      'INTEGRITY_CERT_SHA256',
      'GOOGLE_SERVICE_ACCOUNT_JSON',
    ]) {
      expect(problemFor(base, variable)).toBe('missing');
    }
  });

  it('accepts enforce with all three values, and normalises the certificate digest', () => {
    const upperWithColons = TEST_CERT_SHA256.toUpperCase().replace(/(..)(?!$)/g, '$1:');
    const result = parseConfig({
      ...valid,
      ...enforceEnv(),
      INTEGRITY_CERT_SHA256: upperWithColons,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.INTEGRITY_CERT_SHA256).toEqual([TEST_CERT_SHA256]);
  });

  it('accepts several certificate digests (certificate rotation)', () => {
    const result = parseConfig({
      ...valid,
      ...enforceEnv(),
      INTEGRITY_CERT_SHA256: `${TEST_CERT_SHA256}, ${'cd'.repeat(32)}`,
    });
    expect(result.ok && result.config.INTEGRITY_CERT_SHA256).toHaveLength(2);
  });

  it.each([
    ['INTEGRITY_CERT_SHA256', 'abcd'],
    ['INTEGRITY_CERT_SHA256', 'zz'.repeat(32)],
    ['INTEGRITY_PACKAGE_NAME', 'not a package'],
    ['INTEGRITY_PACKAGE_NAME', 'singleword'],
    ['GOOGLE_SERVICE_ACCOUNT_JSON', 'not-json'],
    ['GOOGLE_SERVICE_ACCOUNT_JSON', '{"type":"authorized_user"}'],
    ['GOOGLE_SERVICE_ACCOUNT_JSON', '{"type":"service_account","client_email":"a@b.c"}'],
  ])('rejects %s=%s', (variable, value) => {
    const result = parseConfig({ ...valid, ...enforceEnv(), [variable]: value });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.variable)).toContain(variable);
  });

  it('lets bypass run without any Google values', () => {
    expect(parseConfig({ ...valid, INTEGRITY_MODE: 'bypass' }).ok).toBe(true);
  });

  it('REFUSES bypass when NODE_ENV=production, even with a valid https URL', () => {
    const env = {
      ...valid,
      NODE_ENV: 'production',
      APP_PUBLIC_BASE_URL: 'https://api.example.app',
      INTEGRITY_MODE: 'bypass',
    };
    expect(problemFor(env, 'INTEGRITY_MODE')).toBe(
      'bypass is not allowed when NODE_ENV=production',
    );
  });

  it('accepts enforce in production', () => {
    const env = {
      ...valid,
      ...enforceEnv(),
      NODE_ENV: 'production',
      APP_PUBLIC_BASE_URL: 'https://api.example.app',
    };
    expect(parseConfig(env).ok).toBe(true);
  });

  it('keeps the parsed service account to the fields it needs', () => {
    const result = parseConfig({ ...valid, ...enforceEnv() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.config.GOOGLE_SERVICE_ACCOUNT_JSON ?? {}).sort()).toEqual([
      'client_email',
      'private_key',
      'type',
    ]);
  });
});

describe('TRUST_PROXY', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    ['10.0.0.0/8', ['10.0.0.0/8']],
    ['10.0.0.0/8, 172.16.0.5', ['10.0.0.0/8', '172.16.0.5']],
    ['loopback', ['loopback']],
    ['fd00::/8', ['fd00::/8']],
  ])('accepts %s', (value, expected) => {
    const result = parseConfig({ ...valid, TRUST_PROXY: value });
    expect(result.ok && result.config.TRUST_PROXY).toEqual(expected);
  });

  it.each(['true', 'false', '0', '11', 'yes', '*', '0.0.0.0/0', '::/0', '10.0.0.0/33', 'abc'])(
    'rejects %s (trusting every client-supplied address defeats the rate limits)',
    (value) => {
      expect(parseConfig({ ...valid, TRUST_PROXY: value }).ok).toBe(false);
    },
  );

  it('is off when empty', () => {
    const result = parseConfig({ ...valid, TRUST_PROXY: '' });
    expect(result.ok && result.config.TRUST_PROXY).toBe(false);
  });
});

describe('config failure output never contains values', () => {
  const SECRET_REDIS_PASSWORD = 'SENTINEL_REDIS_PASSWORD_42';
  const BAD_VALUE = 'SENTINEL_NOT_A_URL_77';
  const SECRET_KEY_TEXT = 'SENTINEL_PRIVATE_KEY_TEXT_55';
  const env = {
    ...without('DATABASE_URL'),
    REDIS_URL: `redis://:${SECRET_REDIS_PASSWORD}@localhost:6379/0`,
    APP_PUBLIC_BASE_URL: BAD_VALUE,
    JWT_PRIVATE_KEYS: JSON.stringify({
      k1: `-----BEGIN PRIVATE KEY-----\n${SECRET_KEY_TEXT}\n-----END PRIVATE KEY-----`,
    }),
    JWT_ACTIVE_KID: 'k1',
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: 'service_account',
      client_email: BAD_VALUE,
    }),
    INTEGRITY_CERT_SHA256: BAD_VALUE,
    INTEGRITY_PACKAGE_NAME: BAD_VALUE,
    TRUST_PROXY: BAD_VALUE,
  };

  it('parseConfig issues carry names and fixed messages only', () => {
    const result = parseConfig(env);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialised = JSON.stringify(result.issues);
    expect(serialised).toContain('DATABASE_URL');
    expect(serialised).toContain('JWT_PRIVATE_KEYS');
    expect(serialised).not.toContain(BAD_VALUE);
    expect(serialised).not.toContain(SECRET_REDIS_PASSWORD);
    expect(serialised).not.toContain(SECRET_KEY_TEXT);
  });

  it('loadConfigOrExit writes a names-only message and exits with code 1', () => {
    const written: string[] = [];
    let exitCode: number | undefined;
    const io = {
      write: (text: string) => void written.push(text),
      exit: (code: number): never => {
        exitCode = code;
        throw new Error('exit called');
      },
    };

    expect(() => loadConfigOrExit(env, io)).toThrow('exit called');

    const output = written.join('');
    expect(exitCode).toBe(1);
    expect(output).toContain('DATABASE_URL: missing');
    expect(output).toContain('APP_PUBLIC_BASE_URL');
    expect(output).toContain('JWT_PRIVATE_KEYS');
    expect(output).not.toContain(BAD_VALUE);
    expect(output).not.toContain(SECRET_REDIS_PASSWORD);
    expect(output).not.toContain(SECRET_KEY_TEXT);
  });

  it('a valid Google service account is never echoed either', () => {
    const json = googleServiceAccountJson();
    const result = parseConfig({
      ...valid,
      ...enforceEnv(),
      GOOGLE_SERVICE_ACCOUNT_JSON: json,
      NODE_ENV: 'production',
    });
    // production with an http URL fails: the output must still not contain the private key.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const privateKey = (JSON.parse(json) as { private_key: string }).private_key;
      expect(JSON.stringify(result.issues)).not.toContain(privateKey.slice(30, 60));
    }
  });
});
