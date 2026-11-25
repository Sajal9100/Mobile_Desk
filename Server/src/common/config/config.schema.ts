import { z } from 'zod';

/**
 * Every environment variable the server reads, validated once at startup (rule: fail closed).
 * Add a variable here FIRST, then to .env.example, then use it through ConfigService.
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
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'production' && !hasProtocol(config.APP_PUBLIC_BASE_URL, ['https:'])) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_PUBLIC_BASE_URL'],
        message: 'must be https in production',
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;
