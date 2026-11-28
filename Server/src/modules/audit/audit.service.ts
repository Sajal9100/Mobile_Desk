import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { LOGGER } from '../../common/logger.module.js';

/**
 * Security events that must be traceable afterwards. Phase 2 writes them as structured log lines
 * (`audit: true`); a persisted audit table comes with the session audit trail (Phase 4/6).
 */
export type AuditEvent =
  | 'login_failed'
  | 'integrity_failed'
  | 'refresh_reuse_detected'
  | 'account_deleted'
  | 'rate_limited';

/** Identifiers and codes only. Never an email, a password, a token or a nonce. */
export type AuditFields = Record<
  string,
  string | number | boolean | readonly string[] | null | undefined
>;

const WARNING_EVENTS: ReadonlySet<AuditEvent> = new Set(['refresh_reuse_detected']);

@Injectable()
export class AuditService {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  record(event: AuditEvent, fields: AuditFields = {}): void {
    const line = { audit: true, event, ...fields };
    if (WARNING_EVENTS.has(event)) {
      this.logger.warn(line, `audit: ${event}`);
    } else {
      this.logger.info(line, `audit: ${event}`);
    }
  }
}
