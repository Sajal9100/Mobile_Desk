#!/usr/bin/env node
// End-to-end smoke test of the accounts API against a RUNNING server (the compose stack or a
// staging environment):
//
//   node scripts/smoke-auth.mjs http://127.0.0.1:3000
//
// It registers a throwaway user, signs in, calls /api/me, rotates the refresh token, proves that
// reusing the old one revokes the family, signs in again, logs out, and finally deletes the account.
//
// Needs INTEGRITY_MODE=bypass on the server (the default of the local stack): a real Play
// Integrity token only exists on a phone. Prints step names and HTTP status codes only; tokens,
// passwords and the email are never printed. Limits to keep in mind when running it repeatedly:
// registration is 5 per hour per IP.
//
// Node built-ins only, so there is nothing to install.

import { randomBytes } from 'node:crypto';

const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const email = `smoke-${randomBytes(6).toString('hex')}@example.com`;
const password = `Smoke-${randomBytes(9).toString('base64url')}-1`;

let failures = 0;

function report(ok, step, detail) {
  if (!ok) failures += 1;
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'}  ${step}${detail === undefined ? '' : `  (${detail})`}\n`,
  );
}

async function call(method, path, { body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json, headers: response.headers };
}

/** Checks the status (and optionally the error code) of a response; returns the JSON body. */
function expect(step, response, status, errorCode) {
  const code = response.json?.error?.code;
  const ok = response.status === status && (errorCode === undefined || code === errorCode);
  report(ok, step, `HTTP ${response.status}${code === undefined ? '' : ` ${code}`}`);
  return response.json;
}

async function newNonce() {
  const response = await call('GET', '/api/integrity/nonce');
  return response.json?.nonce;
}

async function main() {
  process.stdout.write(`Smoke test against ${baseUrl}\n`);

  expect('GET /health', await call('GET', '/health'), 200);
  expect('GET /ready', await call('GET', '/ready'), 200);

  expect(
    'GET /api/me without a token is refused',
    await call('GET', '/api/me'),
    401,
    'unauthorized',
  );

  const registered = expect(
    'POST /api/auth/register',
    await call('POST', '/api/auth/register', {
      body: {
        displayName: 'Smoke Test',
        email,
        password,
        integrityToken: 'smoke-test-token',
        integrityNonce: await newNonce(),
      },
    }),
    201,
  );
  if (registered === undefined) return;

  expect(
    'POST /api/auth/register with the same email is refused',
    await call('POST', '/api/auth/register', {
      body: {
        displayName: 'Smoke Test',
        email: email.toUpperCase(),
        password,
        integrityToken: 'smoke-test-token',
        integrityNonce: await newNonce(),
      },
    }),
    409,
    'email_taken',
  );

  const me = expect(
    'GET /api/me',
    await call('GET', '/api/me', { token: registered.accessToken }),
    200,
  );
  report(me?.user?.email === email.toLowerCase(), 'GET /api/me returns the same user');

  expect(
    'POST /api/auth/login with a wrong password',
    await call('POST', '/api/auth/login', {
      body: {
        email,
        password: `${password}x`,
        integrityToken: 'smoke-test-token',
        integrityNonce: await newNonce(),
      },
    }),
    401,
    'invalid_credentials',
  );

  const loggedIn = expect(
    'POST /api/auth/login',
    await call('POST', '/api/auth/login', {
      body: {
        email,
        password,
        integrityToken: 'smoke-test-token',
        integrityNonce: await newNonce(),
      },
    }),
    200,
  );
  if (loggedIn === undefined) return;

  const rotated = expect(
    'POST /api/auth/refresh',
    await call('POST', '/api/auth/refresh', { body: { refreshToken: loggedIn.refreshToken } }),
    200,
  );
  if (rotated === undefined) return;
  report(rotated.refreshToken !== loggedIn.refreshToken, 'the refresh token was rotated');
  expect(
    'GET /api/me with the refreshed access token',
    await call('GET', '/api/me', { token: rotated.accessToken }),
    200,
  );

  expect(
    'POST /api/auth/refresh with the OLD token is detected as reuse',
    await call('POST', '/api/auth/refresh', { body: { refreshToken: loggedIn.refreshToken } }),
    401,
    'refresh_reuse_detected',
  );
  expect(
    'the new token of that family is revoked too',
    await call('POST', '/api/auth/refresh', { body: { refreshToken: rotated.refreshToken } }),
    401,
    'invalid_refresh_token',
  );

  const second = expect(
    'POST /api/auth/login (new session)',
    await call('POST', '/api/auth/login', {
      body: {
        email,
        password,
        integrityToken: 'smoke-test-token',
        integrityNonce: await newNonce(),
      },
    }),
    200,
  );
  if (second === undefined) return;
  expect(
    'POST /api/auth/logout',
    await call('POST', '/api/auth/logout', { body: { refreshToken: second.refreshToken } }),
    204,
  );
  expect(
    'refresh after logout is refused',
    await call('POST', '/api/auth/refresh', { body: { refreshToken: second.refreshToken } }),
    401,
    'invalid_refresh_token',
  );

  const third = expect(
    'POST /api/auth/login (for deletion)',
    await call('POST', '/api/auth/login', {
      body: {
        email,
        password,
        integrityToken: 'smoke-test-token',
        integrityNonce: await newNonce(),
      },
    }),
    200,
  );
  if (third === undefined) return;
  expect(
    'DELETE /api/account with a wrong password',
    await call('DELETE', '/api/account', {
      body: { password: `${password}x` },
      token: third.accessToken,
    }),
    401,
    'invalid_credentials',
  );
  expect(
    'DELETE /api/account',
    await call('DELETE', '/api/account', { body: { password }, token: third.accessToken }),
    204,
  );
  expect(
    'the deleted account cannot sign in',
    await call('POST', '/api/auth/login', {
      body: {
        email,
        password,
        integrityToken: 'smoke-test-token',
        integrityNonce: await newNonce(),
      },
    }),
    401,
    'invalid_credentials',
  );
  expect(
    'its access token stopped working at once',
    await call('GET', '/api/me', { token: third.accessToken }),
    401,
    'unauthorized',
  );
}

try {
  await main();
} catch (error) {
  failures += 1;
  // The message of a network error (for example ECONNREFUSED) is safe to print.
  process.stdout.write(
    `FAIL  smoke test aborted: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
}

process.stdout.write(failures === 0 ? '\nAll steps passed.\n' : `\n${failures} step(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
