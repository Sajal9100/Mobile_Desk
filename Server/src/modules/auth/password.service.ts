import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * OWASP baseline for Argon2id (m = 19 MiB, t = 2, p = 1). Raise the memory only after measuring:
 * the brief wants a hash to stay at or under 250 ms on the real server (Phase 6 re-measures).
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  /** A hash of a random password nobody knows, made once with the CURRENT parameters. */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash(randomBytes(24).toString('base64url'), ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  /** False for a wrong password and for a stored hash that cannot be parsed; never throws. */
  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(storedHash, password);
    } catch {
      return false;
    }
  }

  /** True when the stored hash was made with weaker parameters than today's. */
  needsRehash(storedHash: string): boolean {
    try {
      return argon2.needsRehash(storedHash, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }

  /**
   * Spends the same time as a real check. Login calls it when the email is unknown or the account
   * is deleted, so the response time does not reveal whether an account exists.
   */
  async verifyAgainstDummy(password: string): Promise<void> {
    await this.verify(this.dummyHash, password);
  }
}
