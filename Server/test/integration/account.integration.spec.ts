import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PASSWORD, type ErrorPayload } from './helpers/client.js';
import { startStack, stopStack, type Stack } from './helpers/stack.js';

// Needs Docker. DELETE /api/account: soft delete, revoke every family, block login.

describe('DELETE /api/account', () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack({ captureLogs: true });
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  const deleteAccount = (token: string, password: string, ip?: string) =>
    stack.client.delete(
      '/api/account',
      { password },
      { token, ...(ip === undefined ? {} : { ip }) },
    );
  const codeOf = (response: { json: <T>() => T }) => response.json<ErrorPayload>().error.code;

  it('a wrong password is 401 invalid_credentials and changes nothing', async () => {
    const user = await stack.client.signUp();

    const response = await deleteAccount(user.accessToken, 'not-the-password-1');
    expect(response.status).toBe(401);
    // Not "unauthorized": the app must not mistake it for an expired access token and refresh.
    expect(codeOf(response)).toBe('invalid_credentials');

    expect((await stack.client.get('/api/me', { token: user.accessToken })).status).toBe(200);
    expect((await stack.client.refresh(user.refreshToken)).status).toBe(200);
    const row = await stack.prisma.user.findUniqueOrThrow({ where: { id: user.user.id } });
    expect(row.deletedAt).toBeNull();
  });

  it('with the right password: 204, then the account stops working everywhere', async () => {
    const user = await stack.client.signUp();
    // A second session of the same user, so "every family" is really tested.
    const second = (await stack.client.login(user.user.email, user.password)).json<{
      accessToken: string;
      refreshToken: string;
    }>();
    // Warm the status cache: the deletion must clear it, not wait for it to expire.
    expect((await stack.client.get('/api/me', { token: user.accessToken })).status).toBe(200);
    expect(await stack.redisClient.get(`user-status:${user.user.id}`)).toBe('active');

    const response = await deleteAccount(user.accessToken, user.password);
    expect(response.status).toBe(204);
    expect(response.text).toBe('');

    // 1. The access tokens that were already issued are dead immediately.
    expect((await stack.client.get('/api/me', { token: user.accessToken })).status).toBe(401);
    expect((await stack.client.get('/api/me', { token: second.accessToken })).status).toBe(401);

    // 2. Every refresh token of every family is revoked.
    const rows = await stack.prisma.refreshToken.findMany({ where: { userId: user.user.id } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
    for (const token of [user.refreshToken, second.refreshToken]) {
      const refresh = await stack.client.refresh(token);
      expect(refresh.status).toBe(401);
      expect(codeOf(refresh)).toBe('invalid_refresh_token');
    }

    // 3. Login is blocked, with the same answer as an unknown account.
    const login = await stack.client.login(user.user.email, user.password);
    expect(login.status).toBe(401);
    expect(codeOf(login)).toBe('invalid_credentials');

    // 4. It is a soft delete: the row stays, marked, and keeps the email reserved.
    const row = await stack.prisma.user.findUniqueOrThrow({ where: { id: user.user.id } });
    expect(row.deletedAt).toBeInstanceOf(Date);
    const again = await stack.client.register({ email: user.user.email });
    expect(again.response.status).toBe(409);
    expect(codeOf(again.response)).toBe('email_taken');
  });

  it('a deleted account looks exactly like one that never existed when signing in', async () => {
    const user = await stack.client.signUp();
    await deleteAccount(user.accessToken, user.password);

    const deleted = await stack.client.login(user.user.email, user.password);
    const unknown = await stack.client.login(`ghost-${user.user.email}`, user.password);
    const strip = (text: string) => {
      const error = (JSON.parse(text) as ErrorPayload).error;
      return { code: error.code, message: error.message };
    };
    expect(deleted.status).toBe(unknown.status);
    expect(strip(deleted.text)).toEqual(strip(unknown.text));
  });

  it('cannot be repeated with the same token, and needs a token at all', async () => {
    const user = await stack.client.signUp();
    expect((await deleteAccount(user.accessToken, user.password)).status).toBe(204);
    expect((await deleteAccount(user.accessToken, user.password)).status).toBe(401);

    const anonymous = await stack.client.delete('/api/account', { password: DEFAULT_PASSWORD });
    expect(anonymous.status).toBe(401);
    expect(codeOf(anonymous)).toBe('unauthorized');
  });

  it("only the caller's own account is affected", async () => {
    const victim = await stack.client.signUp();
    const caller = await stack.client.signUp();

    // Whatever the body says, the account is the one the token belongs to.
    const response = await stack.client.delete(
      '/api/account',
      { password: caller.password },
      { token: caller.accessToken },
    );
    expect(response.status).toBe(204);

    expect((await stack.client.get('/api/me', { token: victim.accessToken })).status).toBe(200);
    expect((await stack.client.refresh(victim.refreshToken)).status).toBe(200);
    const unknownField = await stack.client.delete(
      '/api/account',
      { password: victim.password, userId: caller.user.id },
      { token: victim.accessToken },
    );
    expect(unknownField.status).toBe(400); // an attempt to name another account is rejected outright
  });

  it('is limited to 5 attempts per 15 minutes per user (it checks a password)', async () => {
    const user = await stack.client.signUp();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await deleteAccount(user.accessToken, `wrong-password-${attempt}`);
      expect(response.status, `attempt ${attempt}`).toBe(401);
    }

    const sixth = await deleteAccount(user.accessToken, user.password); // even the right one
    expect(sixth.status).toBe(429);
    expect(codeOf(sixth)).toBe('rate_limited');
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    expect((await stack.client.get('/api/me', { token: user.accessToken })).status).toBe(200);
  });

  it.each([
    ['no password', {}],
    ['an empty password', { password: '' }],
    ['a password that is too long', { password: 'x'.repeat(129) }],
    ['a non-string password', { password: 12345678 }],
    ['an extra field', { password: 'whatever-1', confirm: true }],
  ])('rejects %s with 400', async (_name, body) => {
    const user = await stack.client.signUp();
    const response = await stack.client.delete('/api/account', body, { token: user.accessToken });
    expect(response.status).toBe(400);
    expect(codeOf(response)).toBe('validation_failed');
  });

  it('leaves an audit line with the user id only', async () => {
    const user = await stack.client.signUp();
    await deleteAccount(user.accessToken, user.password);

    const lines = stack
      .logText()
      .split('\n')
      .filter((line) => line.includes('"event":"account_deleted"'));
    const mine = lines.filter((line) => line.includes(user.user.id));
    expect(mine).toHaveLength(1);
    expect(mine[0]).not.toContain(user.user.email);
    expect(mine[0]).not.toContain(user.password);
  });
});
