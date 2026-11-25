import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { REDACT_CENSOR, SENSITIVE_KEYS, createLogger } from '../../src/common/logger.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  const logger = createLogger({ level: 'info', service: 'test' }, stream);
  return { logger, lines, text: () => JSON.stringify(lines) };
}

/** { a: { b: { key: value } } } with `depth` wrapper levels. */
function nest(key: string, value: string, depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = { [key]: value };
  for (let level = 0; level < depth; level++) node = { wrapper: node };
  return node;
}

describe('logger redaction', () => {
  it("redacts password, token and sdp (the brief's example)", () => {
    const { logger, lines } = capture();
    logger.info({ password: 'hunter2', token: 'tok-123', sdp: 'v=0 o=- 4611' }, 'x');
    expect(lines[0]).toMatchObject({
      password: REDACT_CENSOR,
      token: REDACT_CENSOR,
      sdp: REDACT_CENSOR,
    });
  });

  describe.each(SENSITIVE_KEYS)('key "%s"', (key) => {
    it.each([0, 1, 2, 3])('is redacted at nesting depth %i', (depth) => {
      const { logger, text } = capture();
      const secret = `SECRET_${key}_${depth}`;
      logger.info(nest(key, secret, depth), 'x');
      expect(text()).not.toContain(secret);
      expect(text()).toContain(REDACT_CENSOR);
    });
  });

  it('redacts a sensitive key inside an array of objects', () => {
    const { logger, text } = capture();
    logger.info({ devices: [{ fcmToken: 'FCM_SECRET_VALUE' }] }, 'x');
    expect(text()).not.toContain('FCM_SECRET_VALUE');
  });

  it('keeps non-sensitive fields', () => {
    const { logger, lines } = capture();
    logger.info({ userId: 'u-1', password: 'p' }, 'hello');
    expect(lines[0]).toMatchObject({ userId: 'u-1', msg: 'hello', service: 'test' });
  });

  it('never logs an authorization header or a query string', () => {
    const { logger, lines, text } = capture();
    logger.info(
      {
        req: {
          method: 'GET',
          url: '/api/thing?ticket=QUERY_SECRET&x=1',
          ip: '127.0.0.1',
          headers: { authorization: 'Bearer HEADER_SECRET' },
        },
      },
      'incoming request',
    );
    expect(text()).not.toContain('HEADER_SECRET');
    expect(text()).not.toContain('QUERY_SECRET');
    expect(lines[0]).toMatchObject({ req: { method: 'GET', path: '/api/thing' } });
  });
});
