import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { isIPv6 } from 'node:net';

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** "2001:db8::1" -> its 8 groups, each padded to 4 hex digits; undefined if it is not plain IPv6. */
function expandIpv6(address: string): string[] | undefined {
  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === undefined || halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves[1] === undefined || halves[1] === '' ? [] : halves[1].split(':');
  if (halves.length === 1) {
    if (head.length !== 8) return undefined;
    return head.map((group) => group.padStart(4, '0').toLowerCase());
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return [...head, ...Array<string>(missing).fill('0'), ...tail].map((group) =>
    group.padStart(4, '0').toLowerCase(),
  );
}

/**
 * The key a client is rate limited under.
 *
 * - IPv4-mapped IPv6 (`::ffff:1.2.3.4`) is the same client as `1.2.3.4`.
 * - An IPv6 client is identified by its /64: one subscriber normally owns a whole /64 and can use
 *   any address in it, so a per-address limit would be trivial to walk around.
 */
export function normalizeIp(ip: string): string {
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped?.[1] !== undefined) return mapped[1];
  const withoutZone = ip.split('%', 1)[0] ?? ip;
  if (isIPv6(withoutZone)) {
    const groups = expandIpv6(withoutZone);
    if (groups !== undefined) return `${groups.slice(0, 4).join(':')}::/64`;
  }
  return ip;
}

/**
 * The caller's address as Fastify resolved it: the socket address, or the forwarded one only when
 * the immediate peer is a configured trusted proxy (TRUST_PROXY). Never read X-Forwarded-For by hand.
 */
export const ClientIp = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return normalizeIp(context.switchToHttp().getRequest<FastifyRequest>().ip);
});
