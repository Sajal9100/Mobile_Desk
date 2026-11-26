#!/usr/bin/env node
// Verification for the THROWAWAY spike relay (Server Phase 1, gate item 2 and the controls).
//
//   node infra/coturn/spike-verify.mjs <relay-host-or-ip> [--port 3478] [--user spike] [--udp|--tcp]
//
// The password is read from the TURN_PASSWORD environment variable or from a hidden prompt. It is
// never taken from the command line, never printed, and never written to a file. The relay address
// is not printed either, so the summary is safe to paste into the phase report.
//
// Why not turnutils_uclient: it leaves its allocations alive after an error exit, and the spike's
// user-quota=4 is used up after one or two runs (error 486), so a battery of checks fails for the
// wrong reason. This client opens ONE allocation per transport, tests every peer on it with
// CreatePermission (RFC 5766), and releases it again with Refresh(lifetime=0).
//
// CreatePermission only installs a permission on the relay: no packet is ever sent to a peer.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';

const MAGIC = 0x2112a442;
const REQUEST = { ALLOCATE: 0x0003, REFRESH: 0x0004, CREATE_PERMISSION: 0x0008 };
const ATTR = {
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  LIFETIME: 0x000d,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_PEER_ADDRESS: 0x0012,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
};
const CLASS_MASK = 0x0110;
const CLASS_SUCCESS = 0x0100;
const CLASS_ERROR = 0x0110;
const REQUEST_TIMEOUT_MS = 6000;

// Every range of the brief's denied-peer-ip list, with its edges, plus multicast.
const MUST_BE_DENIED = [
  ['0.0.0.1', '0.0.0.0/8 start'],
  ['0.255.255.254', '0.0.0.0/8 end'],
  ['10.0.0.1', 'RFC 1918 10/8'],
  ['10.255.255.254', '10/8 end'],
  ['100.64.0.1', 'CGNAT 100.64/10'],
  ['100.127.255.254', '100.64/10 end'],
  ['127.0.0.1', 'loopback'],
  ['169.254.169.254', 'EC2 instance metadata'],
  ['172.16.0.1', '172.16/12 start'],
  ['172.31.0.2', 'default AWS VPC'],
  ['172.31.255.254', '172.16/12 end'],
  ['192.168.1.1', 'RFC 1918 192.168/16'],
  ['224.0.0.1', 'multicast (no-multicast-peers)'],
];
// Just outside the denied ranges, and public: must be granted, or the deny list is too broad.
const MUST_BE_ALLOWED = [
  ['203.0.113.1', 'documentation range, public'],
  ['172.32.0.1', 'just above 172.16/12'],
  ['100.128.0.1', 'just above 100.64/10'],
  ['11.0.0.1', 'just above 10/8'],
];

function pad4(length) {
  return (4 - (length % 4)) % 4;
}

function attribute(type, value) {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(value.length, 2);
  return Buffer.concat([head, value, Buffer.alloc(pad4(value.length))]);
}

function header(type, length, transactionId) {
  const head = Buffer.alloc(20);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(length, 2);
  head.writeUInt32BE(MAGIC, 4);
  transactionId.copy(head, 8);
  return head;
}

/** A STUN request; with `key` it ends in MESSAGE-INTEGRITY (HMAC-SHA1, RFC 5389 section 15.4). */
function build(type, attributes, key) {
  const transactionId = randomBytes(12);
  const body = Buffer.concat(attributes);
  if (key === undefined) {
    return {
      transactionId,
      packet: Buffer.concat([header(type, body.length, transactionId), body]),
    };
  }
  // The length field already counts the 24-byte MESSAGE-INTEGRITY attribute when the HMAC is taken.
  const covered = Buffer.concat([header(type, body.length + 24, transactionId), body]);
  const mac = createHmac('sha1', key).update(covered).digest();
  return {
    transactionId,
    packet: Buffer.concat([covered, attribute(ATTR.MESSAGE_INTEGRITY, mac)]),
  };
}

function parse(buffer) {
  if (buffer.length < 20 || buffer.readUInt32BE(4) !== MAGIC) return null;
  const length = buffer.readUInt16BE(2);
  if (buffer.length < 20 + length) return null;
  const attributes = new Map();
  for (let offset = 20; offset + 4 <= 20 + length;) {
    const type = buffer.readUInt16BE(offset);
    const size = buffer.readUInt16BE(offset + 2);
    attributes.set(type, buffer.subarray(offset + 4, offset + 4 + size));
    offset += 4 + size + pad4(size);
  }
  return {
    type: buffer.readUInt16BE(0),
    transactionId: buffer.subarray(8, 20),
    attributes,
    size: 20 + length,
  };
}

const isSuccess = (message) => (message.type & CLASS_MASK) === CLASS_SUCCESS;
const isError = (message) => (message.type & CLASS_MASK) === CLASS_ERROR;

function errorCode(message) {
  const value = message.attributes.get(ATTR.ERROR_CODE);
  return value === undefined ? undefined : (value[2] & 0x07) * 100 + value[3];
}

function xorPeerAddress(ipv4) {
  const value = Buffer.alloc(8);
  value[1] = 0x01; // IPv4
  value.writeUInt16BE(9 ^ (MAGIC >>> 16), 2); // the port is irrelevant for a permission
  const octets = ipv4.split('.').map(Number);
  const cookie = Buffer.alloc(4);
  cookie.writeUInt32BE(MAGIC, 0);
  for (let index = 0; index < 4; index++) value[4 + index] = octets[index] ^ cookie[index];
  return attribute(ATTR.XOR_PEER_ADDRESS, value);
}

/** One request/response pair at a time, over UDP (with retransmits) or TCP (length-framed). */
class Link {
  constructor(kind, host, port) {
    this.kind = kind;
    this.host = host;
    this.port = port;
    this.pending = new Map();
    this.buffered = Buffer.alloc(0);
  }

  async open() {
    if (this.kind === 'udp') {
      this.socket = dgram.createSocket('udp4');
      this.socket.on('message', (data) => this.deliver(data));
      this.socket.on('error', () => {});
      return;
    }
    await new Promise((resolve, reject) => {
      this.socket = net.connect({ host: this.host, port: this.port }, resolve);
      this.socket.once('error', reject);
      this.socket.on('data', (chunk) => {
        this.buffered = Buffer.concat([this.buffered, chunk]);
        while (this.buffered.length >= 20) {
          const total = 20 + this.buffered.readUInt16BE(2);
          if (this.buffered.length < total) break;
          this.deliver(this.buffered.subarray(0, total));
          this.buffered = this.buffered.subarray(total);
        }
      });
    });
    this.socket.removeAllListeners('error');
    this.socket.on('error', () => {});
  }

  deliver(data) {
    const message = parse(data);
    const waiter = message && this.pending.get(message.transactionId.toString('hex'));
    if (waiter) waiter(message);
  }

  request({ transactionId, packet }) {
    return new Promise((resolve, reject) => {
      const id = transactionId.toString('hex');
      const timers = [];
      const finish = (outcome, value) => {
        timers.forEach(clearTimeout);
        this.pending.delete(id);
        outcome(value);
      };
      this.pending.set(id, (message) => finish(resolve, message));
      timers.push(
        setTimeout(
          () => finish(reject, new Error('no response from the relay')),
          REQUEST_TIMEOUT_MS,
        ),
      );
      const send = () =>
        this.kind === 'udp'
          ? this.socket.send(packet, this.port, this.host)
          : this.socket.write(packet);
      send();
      if (this.kind === 'udp') {
        for (const delay of [500, 1500, 3500]) timers.push(setTimeout(send, delay));
      }
    });
  }

  close() {
    if (this.kind === 'udp') this.socket?.close();
    else this.socket?.destroy();
  }
}

const describe = (message) =>
  isError(message)
    ? `error ${errorCode(message) ?? '?'}`
    : `response 0x${message.type.toString(16)}`;

/** Long-term credential request (RFC 5389 section 10.2), retried once on a stale nonce (438). */
async function authenticated(link, credentials, type, attributes) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const request = build(
      type,
      [
        attribute(ATTR.USERNAME, Buffer.from(credentials.user)),
        attribute(ATTR.REALM, credentials.realm),
        attribute(ATTR.NONCE, credentials.nonce),
        ...attributes,
      ],
      credentials.key,
    );
    const response = await link.request(request);
    if (errorCode(response) === 438 && response.attributes.has(ATTR.NONCE)) {
      credentials.nonce = response.attributes.get(ATTR.NONCE);
      continue;
    }
    return response;
  }
  throw new Error('nonce kept going stale');
}

function credentialsFrom(challenge, user, password) {
  const realm = challenge.attributes.get(ATTR.REALM);
  const nonce = challenge.attributes.get(ATTR.NONCE);
  if (realm === undefined || nonce === undefined) return null;
  const key = createHash('md5').update(`${user}:${realm.toString()}:${password}`).digest();
  return { user, realm, nonce, key };
}

const ALLOCATE_UDP = [attribute(ATTR.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0]))];

/** The whole battery over one transport. Returns [{ name, ok, detail }]. */
async function verifyTransport(kind, { host, port, user, password }) {
  const results = [];
  const record = (name, ok, detail = '') => results.push({ name: `[${kind}] ${name}`, ok, detail });
  const link = new Link(kind, host, port);
  try {
    await link.open();

    // 1. No credentials at all: the server must demand them.
    const bare = await link.request(build(REQUEST.ALLOCATE, ALLOCATE_UDP));
    const challenged = isError(bare) && errorCode(bare) === 401;
    record(
      'allocation without credentials is refused (401)',
      challenged,
      challenged ? '' : `CRITICAL: ${describe(bare)}; the relay may be open to anyone`,
    );
    const real = challenged ? credentialsFrom(bare, user, password) : null;
    if (real === null) {
      record('server sent a realm and nonce', false, 'cannot continue');
      return results;
    }

    // 2. A wrong password must be refused. (The user name is right, so only the password differs.)
    const wrong = { ...real, key: credentialsFrom(bare, user, `${password}x`).key };
    const wrongResponse = await authenticated(link, wrong, REQUEST.ALLOCATE, ALLOCATE_UDP);
    record(
      'wrong password is refused (401)',
      isError(wrongResponse) && errorCode(wrongResponse) === 401,
      isError(wrongResponse) && errorCode(wrongResponse) === 401
        ? ''
        : `CRITICAL: ${describe(wrongResponse)}`,
    );

    // 3. The right credentials get ONE allocation.
    const allocation = await authenticated(link, real, REQUEST.ALLOCATE, ALLOCATE_UDP);
    const allocated = isSuccess(allocation) && allocation.attributes.has(ATTR.XOR_RELAYED_ADDRESS);
    record(
      'correct credentials get an allocation',
      allocated,
      allocated
        ? ''
        : `${describe(allocation)}${errorCode(allocation) === 486 ? ' (user-quota reached; wait for old allocations to expire)' : ''}`,
    );
    if (!allocated) return results;

    // 4. Private and special ranges are refused, on that one allocation.
    for (const [peer, label] of MUST_BE_DENIED) {
      const response = await authenticated(link, real, REQUEST.CREATE_PERMISSION, [
        xorPeerAddress(peer),
      ]);
      const denied = isError(response) && errorCode(response) === 403;
      record(
        `peer ${peer} (${label}) is refused (403)`,
        denied,
        denied ? '' : `CRITICAL: ${describe(response)}`,
      );
    }
    for (const [peer, label] of MUST_BE_ALLOWED) {
      const response = await authenticated(link, real, REQUEST.CREATE_PERMISSION, [
        xorPeerAddress(peer),
      ]);
      record(
        `peer ${peer} (${label}) is granted`,
        isSuccess(response),
        isSuccess(response) ? '' : describe(response),
      );
    }

    // 5. Release the allocation so the quota is free again.
    const lifetime = Buffer.alloc(4);
    const released = await authenticated(link, real, REQUEST.REFRESH, [
      attribute(ATTR.LIFETIME, lifetime),
    ]);
    record(
      'allocation released (Refresh with lifetime 0)',
      isSuccess(released),
      describe(released),
    );
  } catch (error) {
    const text = String(error instanceof Error ? error.message : error)
      .split(host)
      .join('<relay>');
    record('relay reachable', false, `${text} (security group, UDP/TCP 3478?)`);
  } finally {
    link.close();
  }
  return results;
}

async function readPassword() {
  const fromEnvironment = process.env.TURN_PASSWORD;
  if (fromEnvironment) return fromEnvironment;
  if (!process.stdin.isTTY) {
    throw new Error('set TURN_PASSWORD, or run this in a terminal to be asked for it');
  }
  process.stderr.write('TURN password (hidden): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let typed = '';
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stderr.write('\n');
          resolve(typed);
          return;
        }
        if (character === '\u0003') process.exit(130); // Ctrl+C
        typed =
          character === '\u007f' || character === '\b' ? typed.slice(0, -1) : typed + character;
      }
    };
    process.stdin.on('data', onData);
  });
}

function parseArguments(argv) {
  const options = { port: 3478, user: 'spike', kinds: ['udp', 'tcp'] };
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--port') options.port = Number(argv[++index]);
    else if (argument === '--user') options.user = argv[++index];
    else if (argument === '--udp') options.kinds = ['udp'];
    else if (argument === '--tcp') options.kinds = ['tcp'];
    else positional.push(argument);
  }
  options.host = positional[0];
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.host || !Number.isInteger(options.port) || !options.user) {
    process.stderr.write(
      'usage: node infra/coturn/spike-verify.mjs <relay-host-or-ip> [--port 3478] [--user spike] [--udp|--tcp]\n',
    );
    return 2;
  }
  let password;
  try {
    password = await readPassword();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const all = [];
  for (const kind of options.kinds) {
    all.push(...(await verifyTransport(kind, { ...options, password })));
  }
  const clean = (text) =>
    text.split(password).join('<password>').split(options.host).join('<relay>');
  for (const { name, ok, detail } of all) {
    process.stdout.write(
      `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${clean(detail)}` : ''}\n`,
    );
  }
  const failed = all.filter((result) => !result.ok).length;
  process.stdout.write(
    `\n${all.length - failed}/${all.length} checks passed (relay address and password not shown)\n`,
  );
  return failed === 0 ? 0 : 1;
}

process.exitCode = await main();
