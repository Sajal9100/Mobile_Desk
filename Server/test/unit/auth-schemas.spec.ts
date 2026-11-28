import { describe, expect, it } from 'vitest';
import {
  deleteAccountBodySchema,
  displayNameSchema,
  emailSchema,
  loginBodySchema,
  newPasswordSchema,
  refreshBodySchema,
  registerBodySchema,
} from '../../src/modules/auth/auth.schemas.js';

const NONCE = 'A'.repeat(43);
const valid = {
  displayName: 'Alice',
  email: 'alice@example.com',
  password: 'correct-horse-9',
  integrityToken: 'token',
  integrityNonce: NONCE,
};

describe('email normalisation', () => {
  it.each([
    ['alice@example.com', 'alice@example.com'],
    ['  Alice@Example.COM  ', 'alice@example.com'],
    ['A.B+tag@Sub.Example.org', 'a.b+tag@sub.example.org'],
  ])('%j -> %s', (input, expected) => {
    expect(emailSchema.parse(input)).toBe(expected);
  });

  it.each([
    '',
    'plainaddress',
    '@example.com',
    'alice@',
    'alice@@example.com',
    'alice example@example.com',
    `${'a'.repeat(250)}@example.com`, // longer than 254
  ])('rejects %j', (input) => {
    expect(emailSchema.safeParse(input).success).toBe(false);
  });

  it('accepts an address of exactly 254 characters', () => {
    const local = 'a'.repeat(64);
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(50)}.com`;
    const address = `${local}@${domain}`;
    expect(address.length).toBeLessThanOrEqual(254);
    expect(emailSchema.safeParse(address).success).toBe(true);
  });
});

describe('password policy (registration)', () => {
  it.each(['abcdefghi1', 'Password123', 'a1'.repeat(64), 'пароль-12345', 'x'.repeat(9) + '7'])(
    'accepts %j',
    (password) => {
      expect(newPasswordSchema.safeParse(password).success).toBe(true);
    },
  );

  it.each([
    ['too short (9)', 'abcdefgh1'],
    ['no digit', 'abcdefghijkl'],
    ['no letter', '1234567890'],
    ['too long (129)', `a1${'x'.repeat(127)}`],
    ['empty', ''],
  ])('rejects a password that is %s', (_name, password) => {
    expect(newPasswordSchema.safeParse(password).success).toBe(false);
  });

  it('does not trim: spaces count and are kept', () => {
    expect(newPasswordSchema.parse('  abcdefgh1  ')).toBe('  abcdefgh1  ');
  });

  it('login only bounds the size (an old, weaker password must still be able to sign in)', () => {
    const base = { email: 'a@b.co', integrityToken: 't', integrityNonce: NONCE };
    expect(loginBodySchema.safeParse({ ...base, password: 'short' }).success).toBe(true);
    expect(loginBodySchema.safeParse({ ...base, password: '' }).success).toBe(false);
    expect(loginBodySchema.safeParse({ ...base, password: 'x'.repeat(129) }).success).toBe(false);
  });
});

describe('display name', () => {
  it('is trimmed and counted after trimming', () => {
    expect(displayNameSchema.parse('  Al  ')).toBe('Al');
    expect(displayNameSchema.safeParse('  A  ').success).toBe(false); // 1 character after trim
  });

  it.each([
    ['1 character', 'A'],
    ['51 characters', 'x'.repeat(51)],
    ['a newline', 'Al\nice'],
    ['a NUL byte', 'Al\u0000ice'],
    ['a zero-width space', 'Al​ice'],
    ['a right-to-left override', 'Al‮ice'],
    ['a line separator', 'Al ice'],
  ])('rejects %s', (_name, value) => {
    expect(displayNameSchema.safeParse(value).success).toBe(false);
  });

  it('accepts ordinary international names, 2 and 50 characters', () => {
    for (const name of ['Al', 'José Ñandú', '山田 太郎', 'x'.repeat(50)]) {
      expect(displayNameSchema.safeParse(name).success).toBe(true);
    }
  });
});

describe('request bodies', () => {
  it('register: accepts a valid body and normalises the email and name', () => {
    const body = registerBodySchema.parse({
      ...valid,
      email: ' Alice@Example.com ',
      displayName: ' Alice ',
    });
    expect(body.email).toBe('alice@example.com');
    expect(body.displayName).toBe('Alice');
  });

  it('every body rejects unknown fields (strict objects)', () => {
    expect(registerBodySchema.safeParse({ ...valid, role: 'admin' }).success).toBe(false);
    expect(
      loginBodySchema.safeParse({
        email: 'a@b.co',
        password: 'x',
        integrityToken: 't',
        integrityNonce: NONCE,
        userId: 'someone-else',
      }).success,
    ).toBe(false);
    expect(refreshBodySchema.safeParse({ refreshToken: NONCE, deviceId: 'x' }).success).toBe(false);
    expect(deleteAccountBodySchema.safeParse({ password: 'x', confirm: true }).success).toBe(false);
  });

  it.each(['displayName', 'email', 'password', 'integrityToken', 'integrityNonce'])(
    'register requires %s',
    (field) => {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      expect(registerBodySchema.safeParse(body).success).toBe(false);
    },
  );

  it.each([
    ['too short', 'A'.repeat(42)],
    ['too long', 'A'.repeat(44)],
    ['standard base64 characters', `${'A'.repeat(41)}+/`],
    ['padding', `${'A'.repeat(42)}=`],
  ])('a nonce or refresh token that is %s is rejected', (_name, value) => {
    expect(registerBodySchema.safeParse({ ...valid, integrityNonce: value }).success).toBe(false);
    expect(refreshBodySchema.safeParse({ refreshToken: value }).success).toBe(false);
  });

  it('an integrity token is limited to 16 KB', () => {
    expect(
      registerBodySchema.safeParse({ ...valid, integrityToken: 'x'.repeat(16_384) }).success,
    ).toBe(true);
    expect(
      registerBodySchema.safeParse({ ...valid, integrityToken: 'x'.repeat(16_385) }).success,
    ).toBe(false);
  });
});
