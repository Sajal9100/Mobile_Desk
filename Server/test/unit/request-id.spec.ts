import { describe, expect, it } from 'vitest';
import { resolveRequestId } from '../../src/common/request-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a well-formed id', () => {
    expect(resolveRequestId('abc-123_XYZ')).toBe('abc-123_XYZ');
    expect(resolveRequestId('a'.repeat(64))).toBe('a'.repeat(64));
  });

  it('generates a UUID when the header is absent', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID);
  });

  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(65)],
    ['spaces', 'has spaces'],
    ['newline (log injection)', 'abc\ndef'],
    ['quotes', 'a"b'],
    ['unicode', 'ключ'],
  ])('replaces a malformed id: %s', (_name, value) => {
    expect(resolveRequestId(value)).toMatch(UUID);
  });

  it('uses the first value when the header is repeated', () => {
    expect(resolveRequestId(['first-id', 'second-id'])).toBe('first-id');
  });
});
