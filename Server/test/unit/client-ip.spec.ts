import { describe, expect, it } from 'vitest';
import { normalizeIp } from '../../src/common/http/client-ip.js';

describe('normalizeIp (the rate-limit identity of a client)', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['127.0.0.1', '127.0.0.1'],
    // Dual-stack sockets report IPv4 clients as IPv4-mapped IPv6.
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
  ])('IPv4: %s -> %s', (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });

  it('an IPv6 client is one client per /64: every address of the subscriber shares a limit', () => {
    const a = normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    const b = normalizeIp('2001:db8:1:2:1111:2222:3333:4444');
    const c = normalizeIp('2001:db8:1:2::1');
    expect(a).toBe('2001:0db8:0001:0002::/64');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('different /64 networks stay different', () => {
    expect(normalizeIp('2001:db8:1:2::1')).not.toBe(normalizeIp('2001:db8:1:3::1'));
  });

  it.each([
    ['::1', '0000:0000:0000:0000::/64'],
    ['2001:db8::', '2001:0db8:0000:0000::/64'],
    ['fe80::1%eth0', 'fe80:0000:0000:0000::/64'], // zone id ignored
    ['2001:DB8:0:0:0:0:0:1', '2001:0db8:0000:0000::/64'], // case and padding
  ])('IPv6 %s', (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });

  it('leaves anything it does not understand unchanged', () => {
    expect(normalizeIp('not-an-ip')).toBe('not-an-ip');
  });
});
