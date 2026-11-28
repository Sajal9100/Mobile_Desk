import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../../src/common/errors/app.exception.js';
import { createLogger } from '../../src/common/logger.js';
import { GooglePlayIntegrityClient } from '../../src/modules/integrity/play-integrity.client.js';

const SECRET_TOKEN = 'INTEGRITY_TOKEN_SENTINEL_9f3a';
const ACCESS_TOKEN = 'GOOGLE_ACCESS_TOKEN_SENTINEL_77c1';

const GOOD_BODY = {
  tokenPayloadExternal: {
    requestDetails: {
      requestPackageName: 'app.mobiledesk.test',
      requestHash: 'hash',
      timestampMillis: '1800000000000',
    },
    appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', certificateSha256Digest: ['abc'] },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
  },
};

function setup(
  respond: () => Response | Promise<Response>,
  getAccessToken: () => Promise<string | null | undefined> = () => Promise.resolve(ACCESS_TOKEN),
) {
  const lines: string[] = [];
  const logger = createLogger(
    { level: 'trace', service: 'test' },
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    }),
  );
  const fetchImpl = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(respond()),
  );
  const client = new GooglePlayIntegrityClient({
    packageName: 'app.mobiledesk.test',
    getAccessToken,
    logger,
    fetchImpl,
  });
  return { client, fetchImpl, logs: () => lines.join('') };
}

const json = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('GooglePlayIntegrityClient', () => {
  it('posts the token to decodeIntegrityToken for the package, with the Bearer token', async () => {
    const { client, fetchImpl } = setup(() => json(200, GOOD_BODY));
    const result = await client.decode(SECRET_TOKEN);

    expect(result.kind).toBe('decoded');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://playintegrity.googleapis.com/v1/app.mobiledesk.test:decodeIntegrityToken',
    );
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['authorization']).toBe(
      `Bearer ${ACCESS_TOKEN}`,
    );
    expect(JSON.parse(init?.body as string)).toEqual({ integrityToken: SECRET_TOKEN });
    expect(init?.signal).toBeInstanceOf(AbortSignal); // a timeout is always set
  });

  it('returns the decoded payload, without the fields it does not use', async () => {
    const { client } = setup(() =>
      json(200, {
        tokenPayloadExternal: { ...GOOD_BODY.tokenPayloadExternal, accountDetails: { x: 1 } },
      }),
    );
    const result = await client.decode(SECRET_TOKEN);
    expect(result.kind === 'decoded' && result.payload).not.toHaveProperty('accountDetails');
  });

  it('Google 400 means the token is invalid: a rejection, not an outage', async () => {
    const { client } = setup(() => json(400, { error: { status: 'INVALID_ARGUMENT' } }));
    await expect(client.decode(SECRET_TOKEN)).resolves.toEqual({ kind: 'rejected' });
  });

  it.each([401, 403, 404, 429, 500, 502, 503])(
    'Google %i is an outage: 503 integrity_unavailable (retryable)',
    async (status) => {
      const { client } = setup(() => json(status));
      const error = await rejection(client.decode(SECRET_TOKEN));
      expect(error).toMatchObject({ code: 'integrity_unavailable', status: 503 });
      expect(error.retryAfterSeconds).toBeGreaterThan(0);
    },
  );

  it('logs our own credential problems (401/403/404) as errors, other outages as warnings', async () => {
    const credentials = setup(() => json(403));
    await rejection(credentials.client.decode(SECRET_TOKEN));
    expect(credentials.logs()).toContain('"level":50');

    const outage = setup(() => json(503));
    await rejection(outage.client.decode(SECRET_TOKEN));
    expect(outage.logs()).toContain('"level":40');
    expect(outage.logs()).not.toContain('"level":50');
  });

  it('a network failure is 503 integrity_unavailable', async () => {
    const { client } = setup(() => Promise.reject(new TypeError('fetch failed')));
    await expect(rejection(client.decode(SECRET_TOKEN))).resolves.toMatchObject({
      code: 'integrity_unavailable',
    });
  });

  it('a timeout is 503 integrity_unavailable', async () => {
    const { client } = setup(() =>
      Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    );
    await expect(rejection(client.decode(SECRET_TOKEN))).resolves.toMatchObject({
      code: 'integrity_unavailable',
    });
  });

  it('a body that is not JSON is 503 integrity_unavailable', async () => {
    const { client } = setup(() => new Response('<html>oops</html>', { status: 200 }));
    await expect(rejection(client.decode(SECRET_TOKEN))).resolves.toMatchObject({
      code: 'integrity_unavailable',
    });
  });

  it('a body of an unexpected shape is 503 integrity_unavailable, not a verdict', async () => {
    const { client, logs } = setup(() => json(200, { tokenPayloadExternal: { hello: 'world' } }));
    await expect(rejection(client.decode(SECRET_TOKEN))).resolves.toMatchObject({
      code: 'integrity_unavailable',
    });
    expect(logs()).toContain('unexpected shape');
  });

  it.each([
    ['fails', () => Promise.reject(new Error('metadata server down'))],
    ['returns nothing', () => Promise.resolve(null)],
    ['returns an empty token', () => Promise.resolve('')],
  ])('when getting a Google access token %s: 503, and Google is never called', async (_n, get) => {
    const { client, fetchImpl } = setup(() => json(200, GOOD_BODY), get);
    await expect(rejection(client.decode(SECRET_TOKEN))).resolves.toMatchObject({
      code: 'integrity_unavailable',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never logs the integrity token or the Google access token', async () => {
    const cases = [
      setup(() => json(200, GOOD_BODY)),
      setup(() => json(400)),
      setup(() => json(500)),
      setup(() => Promise.reject(new TypeError(`fetch failed ${SECRET_TOKEN} ${ACCESS_TOKEN}`))),
      setup(() => new Response('not json', { status: 200 })),
      setup(() => json(200, { tokenPayloadExternal: {} })),
    ];
    for (const { client, logs } of cases) {
      await client.decode(SECRET_TOKEN).catch(() => undefined);
      expect(logs()).not.toContain(SECRET_TOKEN);
      expect(logs()).not.toContain(ACCESS_TOKEN);
    }
  });
});
