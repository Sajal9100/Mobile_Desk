import { createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';

/**
 * Every environment variable the server reads, validated once at startup (rule: fail closed).
 * Add a variable here FIRST, then to .env.example, then use it through ConfigService.
 *
 * Messages of `custom` issues are fixed strings written here. They are printed at startup, so they
 * must never contain a value (see load-config.ts).
 */

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const port = z.coerce.number().int().min(1).max(65535);

const hasProtocol = (value: string, protocols: readonly string[]): boolean => {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

// z.httpUrl() rejects localhost and bare IPs, so check the protocol ourselves.
const httpUrl = z.url().refine((v) => hasProtocol(v, ['http:', 'https:']));
const postgresUrl = z.url().refine((v) => hasProtocol(v, ['postgres:', 'postgresql:']));
const redisUrl = z.url().refine((v) => hasProtocol(v, ['redis:', 'rediss:']));

/** "a,b" -> ["a","b"]; empty string -> []. Each entry must be an http(s) origin ("*" is rejected). */
const originList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(httpUrl));

/** Docker Compose passes an unset optional variable as an empty string: treat both as "not set". */
const emptyAsUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/** Adds a fixed-message issue to the field being parsed and aborts the transform. */
function fail<T>(ctx: z.core.$RefinementCtx<T>, message: string): typeof z.NEVER {
  ctx.issues.push({ code: 'custom', message, input: ctx.value });
  return z.NEVER;
}

// ---------------------------------------------------------------- JWT signing keys (Phase 2)

const KID = /^[A-Za-z0-9_-]{1,64}$/;

/** JSON map `kid -> PKCS#8 PEM` of Ed25519 private keys. Public keys are derived at startup. */
const jwtPrivateKeys = z.string().transform((raw, ctx): Record<string, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(ctx, 'must be a JSON object that maps key ids to PEM private keys');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail(ctx, 'must be a JSON object that maps key ids to PEM private keys');
  }
  const keys: Record<string, string> = {};
  for (const [kid, pem] of Object.entries(parsed)) {
    if (!KID.test(kid)) return fail(ctx, 'a key id must be 1-64 characters of A-Z a-z 0-9 _ -');
    if (typeof pem !== 'string') return fail(ctx, 'every key must be a PEM string');
    try {
      const key = createPrivateKey({ key: pem, format: 'pem' });
      if (key.asymmetricKeyType !== 'ed25519') {
        return fail(ctx, 'every key must be an Ed25519 private key');
      }
    } catch {
      return fail(ctx, 'every key must be a valid PKCS#8 PEM private key');
    }
    keys[kid] = pem;
  }
  if (Object.keys(keys).length === 0) return fail(ctx, 'must contain at least one key');
  return keys;
});

// ---------------------------------------------------------------- Play Integrity (Phase 2)

const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const androidPackageName = z.string().max(255).regex(ANDROID_PACKAGE);

/**
 * SHA-256 digests of the release signing certificate: hex, colons optional (the Play Console shows
 * "AA:BB:..."). Stored as lower-case hex without separators.
 */
const certDigests = z.string().transform((raw, ctx): string[] => {
  const digests: string[] = [];
  for (const entry of raw.split(',')) {
    const digest = entry.trim().replaceAll(':', '').toLowerCase();
    if (digest === '') continue;
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      return fail(ctx, 'every entry must be a SHA-256 digest: 64 hex characters, colons optional');
    }
    digests.push(digest);
  }
  if (digests.length === 0) return fail(ctx, 'must contain at least one digest');
  return digests;
});

const googleServiceAccountSchema = z.object({
  type: z.literal('service_account'),
  client_email: z.string().min(3).max(320),
  private_key: z.string().min(32).max(8192),
  private_key_id: z.string().max(128).optional(),
  project_id: z.string().max(128).optional(),
});
export type GoogleServiceAccount = z.infer<typeof googleServiceAccountSchema>;

const googleServiceAccountJson = z.string().transform((raw, ctx): GoogleServiceAccount => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(ctx, 'must be the JSON key file of a Google service account');
  }
  const result = googleServiceAccountSchema.safeParse(parsed);
  if (!result.success) return fail(ctx, 'must be the JSON key file of a Google service account');
  return result.data;
});

// ---------------------------------------------------------------- proxy trust (Phase 2)

const PROXY_KEYWORDS: ReadonlySet<string> = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isTrustedProxyEntry(entry: string): boolean {
  if (PROXY_KEYWORDS.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split('/');
  if (address === undefined || rest.length > 0) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  // /0 would trust every client address: the same hole as `true`.
  return bits >= 1 && bits <= (version === 4 ? 32 : 128);
}

/**
 * Which proxies may set X-Forwarded-For. Unset = none (the client IP is the socket address).
 * A hop count (1-10) or a comma-separated list of IPs / CIDRs / loopback|linklocal|uniquelocal.
 * "true" is rejected on purpose: trusting every forwarded header lets a client pick its own IP
 * and walk around the per-IP rate limits.
 */
const trustProxy = z
  .preprocess(emptyAsUndefined, z.string().optional())
  .transform((raw, ctx): false | number | string[] => {
    if (raw === undefined) return false;
    const value = raw.trim();
    if (/^\d+$/.test(value)) {
      const hops = Number(value);
      if (hops >= 1 && hops <= 10) return hops;
      return fail(ctx, 'a hop count must be between 1 and 10');
    }
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length === 0 || !entries.every(isTrustedProxyEntry)) {
      return fail(
        ctx,
        'must be a hop count (1-10) or a list of proxy IPs / CIDRs (not "true", not /0)',
      );
    }
    return entries;
  });

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT_API: port,
    PORT_REALTIME: port,
    /** 127.0.0.1 by default (fail closed); containers set 0.0.0.0. */
    BIND_HOST: z.string().min(1).default('127.0.0.1'),
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** Empty means no CORS at all (mobile-only API). */
    CORS_ORIGINS: originList,
    APP_PUBLIC_BASE_URL: httpUrl,

    /** Ed25519 signing keys, `kid -> PEM`. From the secrets manager; never committed. */
    JWT_PRIVATE_KEYS: jwtPrivateKeys,
    /** The `kid` used to sign new access tokens. Old keys stay listed until their tokens expire. */
    JWT_ACTIVE_KID: z.string().regex(KID),

    /** `enforce` calls Google; `bypass` (local development and tests only) skips the verdict. */
    INTEGRITY_MODE: z.enum(['enforce', 'bypass']).default('enforce'),
    INTEGRITY_PACKAGE_NAME: z.preprocess(emptyAsUndefined, androidPackageName.optional()),
    INTEGRITY_CERT_SHA256: z
      .preprocess(emptyAsUndefined, certDigests.optional())
      .transform((digests) => digests ?? []),
    GOOGLE_SERVICE_ACCOUNT_JSON: z.preprocess(
      emptyAsUndefined,
      googleServiceAccountJson.optional(),
    ),

    TRUST_PROXY: trustProxy,
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'production' && !hasProtocol(config.APP_PUBLIC_BASE_URL, ['https:'])) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_PUBLIC_BASE_URL'],
        message: 'must be https in production',
      });
    }

    if (!Object.hasOwn(config.JWT_PRIVATE_KEYS, config.JWT_ACTIVE_KID)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACTIVE_KID'],
        message: 'must be one of the key ids in JWT_PRIVATE_KEYS',
      });
    }

    if (config.INTEGRITY_MODE === 'bypass' && config.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['INTEGRITY_MODE'],
        message: 'bypass is not allowed when NODE_ENV=production',
      });
    }

    if (config.INTEGRITY_MODE === 'enforce') {
      const required: [string, boolean][] = [
        ['INTEGRITY_PACKAGE_NAME', config.INTEGRITY_PACKAGE_NAME !== undefined],
        ['INTEGRITY_CERT_SHA256', config.INTEGRITY_CERT_SHA256.length > 0],
        ['GOOGLE_SERVICE_ACCOUNT_JSON', config.GOOGLE_SERVICE_ACCOUNT_JSON !== undefined],
      ];
      for (const [name, present] of required) {
        if (!present) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: 'required when INTEGRITY_MODE=enforce',
          });
        }
      }
    }
  });

export type AppConfig = z.infer<typeof configSchema>;
