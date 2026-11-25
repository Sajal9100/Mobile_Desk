import { pino, type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from './config/config.schema.js';

/**
 * The single source of truth for what must never reach a log line (rule 8).
 * Add a key here whenever a new sensitive field is introduced. Sentry's `beforeSend`
 * (Phase 6) scrubs the same list.
 */
export const SENSITIVE_KEYS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'ticket',
  'sdp',
  'candidate',
  'credential',
  'fcmToken',
  'integrityToken',
  'authorization',
] as const;

export const REDACT_CENSOR = '[REDACTED]';

/** pino's `*` matches exactly one level, so cover the key at depth 0 to MAX_REDACT_DEPTH. */
const MAX_REDACT_DEPTH = 3;

function buildRedactPaths(): string[] {
  const paths = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];
  for (const key of SENSITIVE_KEYS) {
    for (let depth = 0; depth <= MAX_REDACT_DEPTH; depth++) {
      paths.push([...Array<string>(depth).fill('*'), key].join('.'));
    }
  }
  return paths;
}

export const REDACT_PATHS: readonly string[] = buildRedactPaths();

type LoggedRequest = { method?: string; url?: string; ip?: string };
type LoggedResponse = { statusCode?: number };

/** Logs the path only: query strings can carry tokens or tickets. */
function serializeRequest(req: LoggedRequest): Record<string, unknown> {
  return {
    method: req.method,
    path: req.url?.split('?', 1)[0],
    remoteAddress: req.ip,
  };
}

export type LoggerSettings = {
  level: AppConfig['LOG_LEVEL'];
  service: string;
};

export function createLogger(settings: LoggerSettings, destination?: DestinationStream): Logger {
  const options = {
    level: settings.level,
    base: { service: settings.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    serializers: {
      req: serializeRequest,
      res: (res: LoggedResponse) => ({ statusCode: res.statusCode }),
    },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
