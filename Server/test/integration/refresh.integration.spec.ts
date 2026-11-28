import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/common/crypto.js';
import type { ErrorPayload } from './helpers/client.js';
import { startStack, stopStack, type Stack } from './helpers/stack.js';

// Needs Docker. Refresh-token rotation, reuse detection, logout and the concurrency cases.

type Pair = { accessToken: string; refreshToken: string };

describe('refresh tokens', () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  const familyOf = async (refreshToken: string): Promise<string> => {
    const row = await stack.prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: sha256Hex(refreshToken) },
    });
    return row.familyId;
  };
  const familyRows = (familyId: string) =>
    stack.prisma.refreshToken.findMany({ where: { familyId }, orderBy: { createdAt: 'asc' } });
  const errorCode = (response: { json: <T>() => T }) => response.json<ErrorPayload>().error.code;

  describe('rotation', () => {
    it('hands out a new pair, and the new access token works', async () => {
      const user = await stack.client.signUp();

      const response = await stack.client.refresh(user.refreshToken);
      expect(response.status).toBe(200);
      const next = response.json<Pair>();
      expect(Object.keys(next).sort()).toEqual(['accessToken', 'refreshToken']);
      expect(next.refreshToken).not.toBe(user.refreshToken);
      expect(next.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(response.headers['cache-control']).toBe('no-store');

      expect((await stack.client.get('/api/me', { token: next.accessToken })).status).toBe(200);
    });

    it('marks the old token used, keeps one family, and keeps the absolute expiry', async () => {
      const user = await stack.client.signUp();
      const first = (await stack.client.refresh(user.refreshToken)).json<Pair>();
      const second = (await stack.client.refresh(first.refreshToken)).json<Pair>();

      const rows = await familyRows(await familyOf(user.refreshToken));
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.tokenHash)).toEqual([
        sha256Hex(user.refreshToken),
        sha256Hex(first.refreshToken),
        sha256Hex(second.refreshToken),
      ]);
      expect(rows.map((row) => row.usedAt !== null)).toEqual([true, true, false]);
      expect(rows.every((row) => row.revokedAt === null)).toBe(true);
      // Refreshing never extends the 30 days that started at login.
      expect(new Set(rows.map((row) => row.expiresAt.getTime())).size).toBe(1);
    });

    it('a chain of refreshes keeps working', async () => {
      let token = (await stack.client.signUp()).refreshToken;
      for (let i = 0; i < 5; i++) {
        const response = await stack.client.refresh(token);
        expect(response.status).toBe(200);
        token = response.json<Pair>().refreshToken;
      }
    });

    it('rejects an unknown token and a malformed one', async () => {
      const unknown = await stack.client.refresh(randomBytes(32).toString('base64url'));
      expect(unknown.status).toBe(401);
      expect(errorCode(unknown)).toBe('invalid_refresh_token');

      const malformed = await stack.client.refresh('not-a-token');
      expect(malformed.status).toBe(400);
      expect(errorCode(malformed)).toBe('validation_failed');
    });

    it('rejects a token whose family has expired, and one that was revoked', async () => {
      const expired = await stack.client.signUp();
      await stack.prisma.refreshToken.updateMany({
        where: { userId: expired.user.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      const response = await stack.client.refresh(expired.refreshToken);
      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('invalid_refresh_token');

      const revoked = await stack.client.signUp();
      await stack.prisma.refreshToken.updateMany({
        where: { userId: revoked.user.id },
        data: { revokedAt: new Date() },
      });
      expect(errorCode(await stack.client.refresh(revoked.refreshToken))).toBe(
        'invalid_refresh_token',
      );
    });

    it('a family that is past its absolute expiry cannot be extended by an earlier refresh', async () => {
      const user = await stack.client.signUp();
      const next = (await stack.client.refresh(user.refreshToken)).json<Pair>();
      await stack.prisma.refreshToken.updateMany({
        where: { userId: user.user.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      expect((await stack.client.refresh(next.refreshToken)).status).toBe(401);
    });

    it('does not accept a refresh token as an access token, or the other way round', async () => {
      const user = await stack.client.signUp();
      expect((await stack.client.get('/api/me', { token: user.refreshToken })).status).toBe(401);
      expect((await stack.client.refresh(user.accessToken)).status).toBe(400);
    });
  });

  describe('reuse detection', () => {
    it('an old token used again -> 401 refresh_reuse_detected, and the NEW token is revoked too', async () => {
      const user = await stack.client.signUp();
      const rotated = (await stack.client.refresh(user.refreshToken)).json<Pair>();

      const reuse = await stack.client.refresh(user.refreshToken);
      expect(reuse.status).toBe(401);
      expect(errorCode(reuse)).toBe('refresh_reuse_detected');

      // The token that came out of the legitimate rotation is dead as well.
      const afterwards = await stack.client.refresh(rotated.refreshToken);
      expect(afterwards.status).toBe(401);
      expect(errorCode(afterwards)).toBe('invalid_refresh_token');

      const rows = await familyRows(await familyOf(user.refreshToken));
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
    });

    it("only the stolen family is affected: the same user's other sessions survive", async () => {
      const first = await stack.client.signUp();
      const other = (await stack.client.login(first.user.email, first.password)).json<
        Pair & { user: unknown }
      >();
      await stack.client.refresh(first.refreshToken);
      await stack.client.refresh(first.refreshToken); // reuse: kills the first family only

      expect((await stack.client.refresh(other.refreshToken)).status).toBe(200);
    });

    it('a family revoked by reuse answers invalid_refresh_token, not another alarm', async () => {
      const user = await stack.client.signUp();
      await stack.client.refresh(user.refreshToken);
      await stack.client.refresh(user.refreshToken); // alarm
      const again = await stack.client.refresh(user.refreshToken);
      expect(errorCode(again)).toBe('invalid_refresh_token');
    });

    it('writes an audit line with ids only', async () => {
      const captured = await startStack({ captureLogs: true });
      try {
        const user = await captured.client.signUp();
        await captured.client.refresh(user.refreshToken);
        await captured.client.refresh(user.refreshToken);

        const line = captured
          .logText()
          .split('\n')
          .filter((entry) => entry.includes('"event":"refresh_reuse_detected"'));
        expect(line).toHaveLength(1);
        const entry = JSON.parse(line[0] ?? '{}') as Record<string, unknown>;
        expect(entry).toMatchObject({ audit: true, userId: user.user.id, level: 40 });
        expect(typeof entry['familyId']).toBe('string');
        expect(line[0]).not.toContain(user.refreshToken);
        expect(line[0]).not.toContain(user.user.email);
      } finally {
        await stopStack(captured);
      }
    });
  });

  describe('concurrency', () => {
    it('two refreshes of the same token at once: exactly one wins, and the family is revoked', async () => {
      for (let round = 0; round < 5; round++) {
        const user = await stack.client.signUp();
        const [a, b] = await Promise.all([
          stack.client.refresh(user.refreshToken),
          stack.client.refresh(user.refreshToken),
        ]);

        expect([a.status, b.status].sort()).toEqual([200, 401]);
        const loser = a.status === 401 ? a : b;
        expect(errorCode(loser)).toBe('refresh_reuse_detected');

        const winner = (a.status === 200 ? a : b).json<Pair>();
        // The winner's new token was revoked by the loser's alarm.
        expect(errorCode(await stack.client.refresh(winner.refreshToken))).toBe(
          'invalid_refresh_token',
        );
        const rows = await familyRows(await familyOf(user.refreshToken));
        expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
      }
    });

    it('a reuse alarm racing the refresh of the NEW token never leaves a live token behind', async () => {
      // The row lock alone cannot guarantee this: the alarm could revoke the family just before
      // the successor is inserted. The per-family advisory lock makes the two strictly ordered.
      for (let round = 0; round < 15; round++) {
        const user = await stack.client.signUp();
        const rotated = (await stack.client.refresh(user.refreshToken)).json<Pair>();

        await Promise.all([
          stack.client.refresh(user.refreshToken), // the thief replays the old token
          stack.client.refresh(rotated.refreshToken), // the owner refreshes the new one
        ]);

        const rows = await familyRows(await familyOf(user.refreshToken));
        const live = rows.filter((row) => row.revokedAt === null);
        expect(live, `round ${round}: live tokens left in the family`).toHaveLength(0);
      }
    });

    it('many different families refresh in parallel without interfering', async () => {
      const users = await Promise.all(Array.from({ length: 8 }, () => stack.client.signUp()));
      const responses = await Promise.all(
        users.map((user) => stack.client.refresh(user.refreshToken)),
      );
      expect(responses.map((response) => response.status)).toEqual(Array<number>(8).fill(200));
    });
  });

  describe('logout', () => {
    it('answers 204 and kills the family: refreshing afterwards fails', async () => {
      const user = await stack.client.signUp();
      const response = await stack.client.logout(user.refreshToken);
      expect(response.status).toBe(204);
      expect(response.text).toBe('');

      const refresh = await stack.client.refresh(user.refreshToken);
      expect(refresh.status).toBe(401);
      expect(errorCode(refresh)).toBe('invalid_refresh_token');
    });

    it('revokes the whole family, not just the presented token', async () => {
      const user = await stack.client.signUp();
      const rotated = (await stack.client.refresh(user.refreshToken)).json<Pair>();

      await stack.client.logout(rotated.refreshToken);

      const rows = await familyRows(await familyOf(user.refreshToken));
      expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
      expect((await stack.client.refresh(rotated.refreshToken)).status).toBe(401);
    });

    it('works with an already-used token too (the family is found through any of its tokens)', async () => {
      const user = await stack.client.signUp();
      const rotated = (await stack.client.refresh(user.refreshToken)).json<Pair>();
      expect((await stack.client.logout(user.refreshToken)).status).toBe(204);
      expect((await stack.client.refresh(rotated.refreshToken)).status).toBe(401);
    });

    it('is idempotent and reveals nothing: an unknown or repeated token is also 204', async () => {
      const user = await stack.client.signUp();
      expect((await stack.client.logout(user.refreshToken)).status).toBe(204);
      expect((await stack.client.logout(user.refreshToken)).status).toBe(204);
      expect((await stack.client.logout(randomBytes(32).toString('base64url'))).status).toBe(204);
      expect((await stack.client.logout('not-a-token')).status).toBe(400);
    });

    it("does not touch the user's other sessions", async () => {
      const first = await stack.client.signUp();
      const second = (await stack.client.login(first.user.email, first.password)).json<Pair>();

      await stack.client.logout(first.refreshToken);

      expect((await stack.client.refresh(second.refreshToken)).status).toBe(200);
    });

    it('does not revoke the access token itself (it simply expires within 15 minutes)', async () => {
      const user = await stack.client.signUp();
      await stack.client.logout(user.refreshToken);
      expect((await stack.client.get('/api/me', { token: user.accessToken })).status).toBe(200);
    });
  });

  describe('rate limit', () => {
    it('30 refreshes per 15 minutes per family, then 429 with Retry-After', async () => {
      const user = await stack.client.signUp();
      let token = user.refreshToken;
      for (let i = 0; i < 30; i++) {
        const response = await stack.client.refresh(token);
        expect(response.status, `refresh ${i + 1}`).toBe(200);
        token = response.json<Pair>().refreshToken;
      }

      const limited = await stack.client.refresh(token);
      expect(limited.status).toBe(429);
      expect(errorCode(limited)).toBe('rate_limited');
      const retryAfter = Number(limited.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    });

    it('counts per family: another family of the same user is not affected', async () => {
      const first = await stack.client.signUp();
      const other = (await stack.client.login(first.user.email, first.password)).json<Pair>();
      let token = first.refreshToken;
      for (let i = 0; i < 31; i++) {
        const response = await stack.client.refresh(token);
        if (response.status === 200) token = response.json<Pair>().refreshToken;
      }
      expect((await stack.client.refresh(other.refreshToken)).status).toBe(200);
    });
  });
});
