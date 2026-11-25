import { describe, expect, it } from 'vitest';
import { loadConfigOrExit, parseConfig } from '../../src/common/config/load-config.js';

const valid = {
  NODE_ENV: 'test',
  PORT_API: '3000',
  PORT_REALTIME: '3001',
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  REDIS_URL: 'redis://:pw@localhost:6379/0',
  APP_PUBLIC_BASE_URL: 'http://localhost:3000',
};

function without(key: string): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...valid };
  delete copy[key];
  return copy;
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
  });

  it.each([
    'NODE_ENV',
    'PORT_API',
    'PORT_REALTIME',
    'DATABASE_URL',
    'REDIS_URL',
    'APP_PUBLIC_BASE_URL',
  ])('rejects a missing %s and says "missing"', (variable) => {
    const result = parseConfig(without(variable));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({ variable, problem: 'missing' });
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
    expect(parseConfig({ ...valid, NODE_ENV: 'production' }).ok).toBe(false);
    expect(
      parseConfig({
        ...valid,
        NODE_ENV: 'production',
        APP_PUBLIC_BASE_URL: 'https://api.example.app',
      }).ok,
    ).toBe(true);
  });

  it('parses CORS_ORIGINS and rejects wildcards and non-origins', () => {
    const ok = parseConfig({ ...valid, CORS_ORIGINS: 'https://a.example, https://b.example' });
    expect(ok.ok && ok.config.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
    expect(parseConfig({ ...valid, CORS_ORIGINS: '*' }).ok).toBe(false);
    expect(parseConfig({ ...valid, CORS_ORIGINS: 'not-an-origin' }).ok).toBe(false);
  });
});

describe('config failure output never contains values', () => {
  const SECRET_REDIS_PASSWORD = 'SENTINEL_REDIS_PASSWORD_42';
  const BAD_VALUE = 'SENTINEL_NOT_A_URL_77';
  const env = {
    ...without('DATABASE_URL'),
    REDIS_URL: `redis://:${SECRET_REDIS_PASSWORD}@localhost:6379/0`,
    APP_PUBLIC_BASE_URL: BAD_VALUE,
  };

  it('parseConfig issues carry names and codes only', () => {
    const result = parseConfig(env);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialised = JSON.stringify(result.issues);
    expect(serialised).toContain('DATABASE_URL');
    expect(serialised).not.toContain(BAD_VALUE);
    expect(serialised).not.toContain(SECRET_REDIS_PASSWORD);
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
    expect(output).not.toContain(BAD_VALUE);
    expect(output).not.toContain(SECRET_REDIS_PASSWORD);
  });
});
